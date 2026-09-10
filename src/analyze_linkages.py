#!/usr/bin/env python3
"""
analyze_gerrit_linkages.py
===========================

Turns a project's retrieved Gerrit data (metadata.json / linkages.json /
comments.json / patchsets.json, one folder per change — metadata.json is
optional; any folder containing at least one of these files is processed)
into something you
can actually read and query:

  1. <report-dir>/<project>.db         - one SQLite DB, EVERY change and
                                          EVERY linkage, nothing sampled or
                                          dropped. This is the source of
                                          truth - query it with any SQL tool.
  2. <report-dir>/changes.csv          - every change, one row each.
  3. <report-dir>/linkages.csv         - every linkage, one row each,
                                          resolved against the other changes
                                          in the project when possible.
  4. <report-dir>/reactions.csv        - every comment that talks like it's
                                          reacting to a linkage (duplicate/
                                          depends-on/blocks/etc. keywords).
  5. <report-dir>/summary.md           - human-readable analysis: totals,
                                          breakdowns, top linked changes,
                                          timeline, review backlog.
  6. <report-dir>/dashboard.html       - searchable/sortable/paginated
                                          browser over ALL changes and ALL
                                          linkages (open it in a browser).

Directory layout expected (as you described):

    output/
      <project>/
        <change-folder>/
          metadata.json
          linkages.json
          comments.json
          patchsets.json

Usage
-----
    python3 analyze_gerrit_linkages.py --output-dir /path/to/output \
                                        --project ccsdk/sli \
                                        --report-dir ./reports

    # process every project folder found under output/
    python3 analyze_gerrit_linkages.py --output-dir /path/to/output --all

Only the standard library is used, so there is nothing to pip install.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

# How much of the (often huge, duplicated) `context` field to keep per
# linkage. We keep a window centered on the actual matched text instead of
# the whole commit message, which is what makes multi-hundred-KB linkage
# files balloon to tens of MB per change.
CONTEXT_WINDOW_CHARS = 220

# Keywords used to flag comments/change-log entries as "reacting to a
# linkage" (duplicate/dependency/etc. discussion). Mirrors the trigger
# phrases used by link-detector.ts so the vocabulary stays consistent.
REACTION_KEYWORDS = [
    "duplicate of", "duplicate", "same as", "related to", "relates to",
    "depends on", "dependency", "blocked by", "blocks", "supersedes",
    "superseded by", "replaces", "replaced by", "cherry-pick", "cherry pick",
    "revert of", "reverts", "see also", "fixed in", "addressed in",
    "already fixed", "already done", "duplicate change", "abandon",
    "abandoning", "won't merge", "wont merge", "not needed",
]
REACTION_RE = re.compile(
    "|".join(re.escape(k) for k in REACTION_KEYWORDS), re.IGNORECASE
)

# A change folder is considered valid if it contains *at least one* of these
# files.  metadata.json is no longer required — the script will still extract
# linkages, comments, and patchset counts from whichever files are present.
CHANGE_FOLDER_KNOWN_FILES = (
    "metadata.json",
    "linkages.json",
    "comments.json",
    "patchsets.json",
)


# ─────────────────────────────────────────────────────────────────────────────
# Small helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  ! could not parse {path}: {e}", file=sys.stderr)
        return None


def get(d: Optional[dict], *keys, default=None):
    """Safe nested dict getter: get(d, 'accounts', 'owner', 'name')."""
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


_FALSY_STRINGS = {"false", "0", "no", "n", "", "null", "none", "undefined"}


def to_bool(v: Any) -> bool:
    """Coerce a linkage flag (isExternal / flagForReview) to a real bool.

    `1 if v else 0` looks safe but isn't: if the upstream JSON ever hands us
    the *string* "false" (bad serializer, a JS `String(bool)` somewhere
    upstream, a CSV round-trip, etc.) plain Python truthiness treats it as
    True, since any non-empty string is truthy. That silently flags/externals
    everything and makes the corresponding dashboard filter look broken (the
    "no" bucket empties out and "yes" swallows almost every row). This makes
    the string case explicit instead of falling through to Python's default
    truthiness.
    """
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() not in _FALSY_STRINGS
    return bool(v)


def source_fields_list(lk: dict) -> list[str]:
    """GerritLinkage.sourceFields is now string[] (was a singular sourceField
    string). Normalize either shape to a clean list, so a project retrieved
    with an older version of the upstream tool still ingests correctly."""
    fields = lk.get("sourceFields")
    if isinstance(fields, list):
        return [str(f) for f in fields if f]
    if isinstance(fields, str) and fields:
        return [fields]
    legacy = lk.get("sourceField")  # pre-rename key, singular
    if isinstance(legacy, str) and legacy:
        return [legacy]
    return []


def snippet_around(context: str, raw: str, window: int = CONTEXT_WINDOW_CHARS) -> str:
    """Return a short excerpt of `context` centered on `raw`, instead of the
    full (often multi-KB, duplicated) context blob."""
    if not context:
        return ""
    idx = context.find(raw) if raw else -1
    if idx == -1:
        text = context[: window * 2]
        return (text + "…") if len(context) > window * 2 else text
    start = max(0, idx - window // 2)
    end = min(len(context), idx + len(raw) + window // 2)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(context) else ""
    return prefix + context[start:end].strip() + suffix


def month_bucket(ts: Optional[str]) -> Optional[str]:
    if not ts or len(ts) < 7:
        return None
    return ts[:7]  # "YYYY-MM"


# ─────────────────────────────────────────────────────────────────────────────
# SQLite schema
# ─────────────────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS changes (
    change_key        TEXT PRIMARY KEY,   -- folder name / gerrit id
    project            TEXT,
    change_id          TEXT,
    number             INTEGER,
    status             TEXT,
    created            TEXT,
    updated            TEXT,
    submitted          TEXT,
    owner_name         TEXT,
    owner_email        TEXT,
    submitter_name     TEXT,
    subject            TEXT,
    num_patchsets      INTEGER DEFAULT 0,
    num_change_log     INTEGER DEFAULT 0,
    num_change_comments  INTEGER DEFAULT 0,
    num_inline_comments  INTEGER DEFAULT 0,
    num_linkages_out   INTEGER DEFAULT 0,
    num_linkages_in    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS linkages (
    linkage_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_change_key  TEXT,
    source_number      INTEGER,
    raw                TEXT,
    host               TEXT,
    target_number      INTEGER,
    target_project     TEXT,
    target_change_id   TEXT,
    target_resolved    INTEGER,   -- 1 if target found among this project's changes
    target_change_key  TEXT,
    target_status      TEXT,
    target_subject     TEXT,
    patchset           INTEGER,
    source_fields       TEXT,   -- comma-joined, since GerritLinkage.sourceFields is now string[]
    detection_method   TEXT,
    confidence         TEXT,
    is_external        INTEGER,
    flag_for_review    INTEGER,
    context_snippet    TEXT,
    context_hash       TEXT,
    FOREIGN KEY (source_change_key) REFERENCES changes(change_key)
);

-- Full (untruncated) linkage context, deduplicated. The same commit message /
-- comment body is frequently the `context` for many linkages at once, so
-- storing it once per unique blob (instead of once per linkage row) is what
-- keeps the "give me the full context" feature from reproducing the
-- multi-hundred-KB-per-change blowup this script otherwise avoids.
CREATE TABLE IF NOT EXISTS contexts (
    context_hash       TEXT PRIMARY KEY,
    context_full       TEXT
);

CREATE TABLE IF NOT EXISTS reactions (
    reaction_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    change_key         TEXT,
    change_number      INTEGER,
    kind               TEXT,      -- 'change_comment' | 'inline_comment' | 'change_log'
    author_name        TEXT,
    author_role        TEXT,
    timestamp          TEXT,
    unresolved         INTEGER,
    matched_keyword    TEXT,
    message_snippet    TEXT,
    FOREIGN KEY (change_key) REFERENCES changes(change_key)
);

CREATE INDEX IF NOT EXISTS idx_linkages_source ON linkages(source_change_key);
CREATE INDEX IF NOT EXISTS idx_linkages_target ON linkages(target_number);
CREATE INDEX IF NOT EXISTS idx_changes_number  ON changes(number);
CREATE INDEX IF NOT EXISTS idx_reactions_change ON reactions(change_key);
"""


# ─────────────────────────────────────────────────────────────────────────────
# Ingestion
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ProjectStats:
    total_changes: int = 0
    total_linkages: int = 0
    total_reactions: int = 0
    parse_errors: list[str] = field(default_factory=list)
    total_subdirs: int = 0
    dirs_no_data_files: list[str] = field(default_factory=list)   # no known data file at all
    dirs_missing_metadata: list[str] = field(default_factory=list)  # kept for compat / logging
    dirs_unreadable_metadata: list[str] = field(default_factory=list)
    duplicate_change_keys: list[str] = field(default_factory=list)


def find_change_dirs(project_dir: Path, stats: ProjectStats) -> list[Path]:
    """Every immediate subdirectory of the project folder is treated as a
    candidate change.  A folder is accepted as long as it contains *at least
    one* of the known data files (metadata.json / linkages.json /
    comments.json / patchsets.json) — metadata.json is no longer required.
    Folders with no recognised data file at all are recorded in
    `stats.dirs_no_data_files` and skipped.  Anything else that can't be
    ingested is recorded in `stats` for a fully explainable count."""
    dirs = []
    all_subdirs = [c for c in sorted(project_dir.iterdir()) if c.is_dir()]
    stats.total_subdirs = len(all_subdirs)
    for child in all_subdirs:
        has_any = any((child / f).exists() for f in CHANGE_FOLDER_KNOWN_FILES)
        if not has_any:
            stats.dirs_no_data_files.append(child.name)
            continue
        # If metadata.json is present, do a cheap validity check so corrupt
        # JSON is reported with the folder name rather than swallowed later.
        meta_path = child / "metadata.json"
        if meta_path.exists():
            try:
                with meta_path.open("r", encoding="utf-8") as f:
                    json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                stats.dirs_unreadable_metadata.append(f"{child.name}: {e}")
                # Still include the folder — the other files may be fine.
                # ingest_change will just treat metadata as None.
        dirs.append(child)
    return dirs


def ingest_change(cur: sqlite3.Cursor, change_dir: Path, project: str,
                   seen_keys: dict) -> tuple[int, int, int]:
    """Load one change folder into the DB. Returns (linkages, comments, log).

    metadata.json is optional — if absent or unparseable the change is still
    ingested using whatever other files (linkages.json / comments.json /
    patchsets.json) are present.  All metadata-derived fields (change_id,
    number, status, timestamps, owner, etc.) simply become NULL/0 in the DB.
    The change_key falls back to the directory name in that case.
    """
    metadata = load_json(change_dir / "metadata.json")  # may be None — that is fine

    linkages = load_json(change_dir / "linkages.json") or []
    comments = load_json(change_dir / "comments.json") or {}
    patchsets = load_json(change_dir / "patchsets.json") or []

    # Derive identity from metadata when available; fall back to the folder
    # name so the row is always uniquely addressable in the DB.
    if isinstance(metadata, dict):
        change_key = metadata.get("id") or change_dir.name
        number = metadata.get("_number")
    else:
        metadata = {}  # treat as empty dict so all get() calls below are safe
        change_key = change_dir.name
        number = None

    if change_key in seen_keys:
        raise ValueError(
            f"duplicate change_key '{change_key}' (folders '{seen_keys[change_key]}' "
            f"and '{change_dir.name}' both produced this id — the second one was "
            f"NOT ingested, INSERT OR REPLACE would have silently overwritten the first)"
        )
    seen_keys[change_key] = change_dir.name

    change_comments = comments.get("change_comments", []) if isinstance(comments, dict) else []
    inline_comments = comments.get("inline_comments", []) if isinstance(comments, dict) else []
    change_log_entries = get(metadata, "change_log", "entries", default=[]) or []

    cur.execute(
        """INSERT OR REPLACE INTO changes
           (change_key, project, change_id, number, status, created, updated,
            submitted, owner_name, owner_email, submitter_name, subject,
            num_patchsets, num_change_log, num_change_comments,
            num_inline_comments, num_linkages_out, num_linkages_in)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
        (
            change_key, project, metadata.get("change_id"), number,
            metadata.get("status"),
            get(metadata, "timestamps", "created"),
            get(metadata, "timestamps", "updated"),
            get(metadata, "timestamps", "submitted"),
            get(metadata, "accounts", "owner", "name"),
            get(metadata, "accounts", "owner", "email"),
            get(metadata, "accounts", "submitter", "name"),
            metadata.get("subject"),
            len(patchsets) if isinstance(patchsets, list) else 0,
            len(change_log_entries),
            len(change_comments),
            len(inline_comments),
            len(linkages) if isinstance(linkages, list) else 0,
        ),
    )

    # ── linkages ────────────────────────────────────────────────────────────
    if isinstance(linkages, list):
        for lk in linkages:
            if not isinstance(lk, dict):
                continue
            raw = lk.get("raw", "") or ""
            context = lk.get("context", "") or ""
            context_hash = None
            if context:
                context_hash = hashlib.sha1(context.encode("utf-8")).hexdigest()[:16]
                # INSERT OR IGNORE: identical context blobs (very common —
                # many linkages point back at the same commit message/comment)
                # are stored exactly once.
                cur.execute(
                    "INSERT OR IGNORE INTO contexts (context_hash, context_full) VALUES (?,?)",
                    (context_hash, context),
                )
            cur.execute(
                """INSERT INTO linkages
                   (source_change_key, source_number, raw, host, target_number,
                    target_project, target_change_id, target_resolved,
                    target_change_key, target_status, target_subject, patchset,
                    source_fields, detection_method, confidence, is_external,
                    flag_for_review, context_snippet, context_hash)
                   VALUES (?,?,?,?,?,?,?,0,NULL,NULL,NULL,?,?,?,?,?,?,?,?)""",
                (
                    change_key, number, raw, lk.get("host"),
                    lk.get("changeNumber") or None, lk.get("project"),
                    lk.get("changeId"), lk.get("patchset"),
                    ", ".join(source_fields_list(lk)), lk.get("detectionMethod"),
                    lk.get("confidence"),
                    1 if to_bool(lk.get("isExternal")) else 0,
                    1 if to_bool(lk.get("flagForReview")) else 0,
                    snippet_around(context, raw),
                    context_hash,
                ),
            )

    # ── reactions (keyword-flagged discussion) ─────────────────────────────
    def scan_comments(items: Iterable[dict], kind: str):
        n = 0
        for c in items or []:
            if not isinstance(c, dict):
                continue
            msg = c.get("message") or ""
            m = REACTION_RE.search(msg)
            if not m:
                continue
            cur.execute(
                """INSERT INTO reactions
                   (change_key, change_number, kind, author_name, author_role,
                    timestamp, unresolved, matched_keyword, message_snippet)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    change_key, number, kind,
                    get(c, "author", "name"), c.get("author_role"),
                    c.get("updated") or c.get("timestamp"),
                    1 if c.get("unresolved") else 0,
                    m.group(0).lower(),
                    msg[:300],
                ),
            )
            n += 1
        return n

    n_react = scan_comments(change_comments, "change_comment")
    n_react += scan_comments(inline_comments, "inline_comment")
    n_react += scan_comments(change_log_entries, "change_log")

    return len(linkages) if isinstance(linkages, list) else 0, \
        len(change_comments) + len(inline_comments), n_react


def resolve_targets(cur: sqlite3.Cursor):
    """Second pass: mark which linkage targets point at a change we actually
    have in this project's dataset, and copy over its status/subject so the
    report can show 'linked to: MERGED - Fix foo' instead of a bare number."""
    cur.execute("""
        UPDATE linkages
        SET target_resolved = 1,
            target_change_key = (SELECT change_key FROM changes WHERE changes.number = linkages.target_number),
            target_status = (SELECT status FROM changes WHERE changes.number = linkages.target_number),
            target_subject = (SELECT subject FROM changes WHERE changes.number = linkages.target_number)
        WHERE target_number IS NOT NULL
          AND target_number != 0
          AND EXISTS (SELECT 1 FROM changes WHERE changes.number = linkages.target_number)
    """)
    cur.execute("""
        UPDATE changes
        SET num_linkages_in = (
            SELECT COUNT(*) FROM linkages
            WHERE linkages.target_number = changes.number AND linkages.target_number != 0
        )
    """)


def ingest_project(output_dir: Path, project: str, db_path: Path) -> ProjectStats:
    project_dir_candidates = [output_dir / project, output_dir / project.replace("/", "-")]
    project_dir = next((p for p in project_dir_candidates if p.is_dir()), None)
    if project_dir is None:
        raise FileNotFoundError(
            f"Could not find a folder for project '{project}' under {output_dir} "
            f"(tried: {[str(p) for p in project_dir_candidates]})"
        )

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    cur = conn.cursor()

    stats = ProjectStats()
    change_dirs = find_change_dirs(project_dir, stats)
    seen_keys: dict = {}
    ingested = 0

    for i, cd in enumerate(change_dirs, 1):
        try:
            n_link, n_comm, n_react = ingest_change(cur, cd, project, seen_keys)
            stats.total_linkages += n_link
            stats.total_reactions += n_react
            ingested += 1
        except ValueError as e:  # duplicate change_key
            stats.duplicate_change_keys.append(str(e))
        except Exception as e:  # keep going even if one change folder is malformed
            stats.parse_errors.append(f"{cd.name}: {e}")
        if i % 2000 == 0:
            print(f"  ... {i}/{len(change_dirs)} changes ingested")
            conn.commit()

    stats.total_changes = ingested

    conn.commit()
    resolve_targets(cur)
    conn.commit()
    conn.close()
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# CSV export
# ─────────────────────────────────────────────────────────────────────────────

def export_csv(db_path: Path, report_dir: Path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    def dump(query: str, out_name: str):
        cur = conn.execute(query)
        cols = [d[0] for d in cur.description]
        path = report_dir / out_name
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(cols)
            w.writerows(cur.fetchall())
        return path

    dump("SELECT * FROM changes ORDER BY number", "changes.csv")
    dump("SELECT * FROM linkages ORDER BY source_number", "linkages.csv")
    dump("SELECT * FROM reactions ORDER BY change_number", "reactions.csv")
    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Markdown summary report
# ─────────────────────────────────────────────────────────────────────────────

def build_summary(db_path: Path, project: str, report_dir: Path, stats: ProjectStats):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    def one(query, *args):
        row = c.execute(query, args).fetchone()
        return row[0] if row else 0

    def rows(query, *args):
        return c.execute(query, args).fetchall()

    total_changes = one("SELECT COUNT(*) FROM changes")
    total_linkages = one("SELECT COUNT(*) FROM linkages")
    total_reactions = one("SELECT COUNT(*) FROM reactions")
    changes_with_links = one("SELECT COUNT(DISTINCT source_change_key) FROM linkages")
    resolved = one("SELECT COUNT(*) FROM linkages WHERE target_resolved = 1")
    external = one("SELECT COUNT(*) FROM linkages WHERE is_external = 1")
    flagged = one("SELECT COUNT(*) FROM linkages WHERE flag_for_review = 1")

    status_breakdown = rows("SELECT status, COUNT(*) n FROM changes GROUP BY status ORDER BY n DESC")
    confidence_breakdown = rows("SELECT confidence, COUNT(*) n FROM linkages GROUP BY confidence ORDER BY n DESC")
    method_breakdown = rows("SELECT detection_method, COUNT(*) n FROM linkages GROUP BY detection_method ORDER BY n DESC")
    # source_fields is a comma-joined multi-value column (GerritLinkage.sourceFields
    # is string[]), so a linkage found in both commit_message and change_log should
    # count toward BOTH buckets below — a plain SQL GROUP BY would instead make
    # "commit_message, change_log" its own separate bucket, which isn't what anyone
    # wants out of a "where do linkages turn up" breakdown.
    field_counter: Counter = Counter()
    for r in rows("SELECT source_fields FROM linkages"):
        for f in (r["source_fields"] or "").split(", "):
            if f:
                field_counter[f] += 1
    field_breakdown = sorted(field_counter.items(), key=lambda kv: -kv[1])

    top_referenced = rows("""
        SELECT target_number, target_subject, target_status, COUNT(*) n
        FROM linkages WHERE target_resolved = 1
        GROUP BY target_number ORDER BY n DESC LIMIT 20
    """)
    top_sources = rows("""
        SELECT source_change_key, source_number,
               (SELECT subject FROM changes ch WHERE ch.change_key = l.source_change_key) subject,
               COUNT(*) n
        FROM linkages l GROUP BY source_change_key ORDER BY n DESC LIMIT 20
    """)
    unresolved_targets = rows("""
        SELECT target_number, COUNT(*) n FROM linkages
        WHERE target_resolved = 0 AND target_number IS NOT NULL AND target_number != 0
        GROUP BY target_number ORDER BY n DESC LIMIT 15
    """)
    timeline = rows("""
        SELECT substr(created,1,7) ym, COUNT(*) n FROM changes
        WHERE created IS NOT NULL GROUP BY ym ORDER BY ym
    """)
    keyword_breakdown = rows("""
        SELECT matched_keyword, COUNT(*) n FROM reactions GROUP BY matched_keyword ORDER BY n DESC LIMIT 20
    """)
    flagged_examples = rows("""
        SELECT source_number, raw, confidence, source_fields, context_snippet
        FROM linkages WHERE flag_for_review = 1 LIMIT 25
    """)

    def pct(n, d):
        return f"{(100.0 * n / d):.1f}%" if d else "0%"

    n_no_data = len(stats.dirs_no_data_files)
    n_bad_meta = len(stats.dirs_unreadable_metadata)
    n_dupe = len(stats.duplicate_change_keys)
    n_other = len(stats.parse_errors)
    # dirs_missing_metadata is no longer a skip reason — folders without
    # metadata.json are still ingested if any other data file is present.
    # Only dirs_no_data_files (no recognised file at all) are skipped.
    n_skipped = n_no_data + n_dupe + n_other

    lines = []
    a = lines.append
    a(f"# Linkage & Change Analysis — `{project}`\n")
    a(f"_Every change and every linkage in this dataset was ingested — nothing was sampled._\n")

    a("## 1. Coverage check\n")
    a(f"- **Subfolders found under the project directory:** {stats.total_subdirs:,}")
    a(f"- **Successfully ingested as changes:** {stats.total_changes:,}")
    if n_bad_meta:
        a(f"- **Note:** {n_bad_meta:,} subfolder(s) had a `metadata.json` that **failed to parse** "
          f"(truncated/corrupt JSON). Those folders were still ingested from their other data files "
          f"(linkages.json / comments.json / patchsets.json); metadata fields will be NULL for them.")
    if n_skipped:
        a(f"- **Skipped: {n_skipped:,}** — see the breakdown below and the full list in `skipped_dirs.log`.")
        if n_no_data:
            a(f"  - {n_no_data:,} subfolder(s) contained **no recognised data file** "
              f"(no metadata.json, linkages.json, comments.json, or patchsets.json).")
        if n_dupe:
            a(f"  - {n_dupe:,} subfolder(s) produced a **change id that duplicated another folder's** "
              f"— only the first-seen folder for that id was kept, so no change was double-counted.")
        if n_other:
            a(f"  - {n_other:,} subfolder(s) hit another error while ingesting (see `skipped_dirs.log`).")
    else:
        a("- **Skipped: 0** — every subfolder containing at least one data file was ingested.")
    a("")

    a("## 2. Headline numbers\n")
    a(f"- **Total changes:** {total_changes:,}")
    a(f"- **Total linkages detected:** {total_linkages:,}")
    a(f"- **Changes that reference at least one other change:** {changes_with_links:,} ({pct(changes_with_links, total_changes)} of all changes)")
    a(f"- **Linkages resolved to a change inside this project's dataset:** {resolved:,} ({pct(resolved, total_linkages)})")
    a(f"- **Linkages pointing outside this project/host:** {external:,} ({pct(external, total_linkages)})")
    a(f"- **Linkages flagged for manual review (low-confidence):** {flagged:,} ({pct(flagged, total_linkages)})")
    a(f"- **Comments/log entries whose text matches a linkage-reaction keyword (duplicate/depends-on/blocks/etc.):** {total_reactions:,}\n")

    a("## 3. Change status breakdown\n")
    a("| Status | Count | % |\n|---|---|---|")
    for r in status_breakdown:
        a(f"| {r['status']} | {r['n']:,} | {pct(r['n'], total_changes)} |")
    a("")

    a("## 4. Linkage confidence breakdown\n")
    a("_High = strong structural evidence (URL, Depends-On trailer, Change-Id). Medium = bare number + strong trigger phrase. Low = weak evidence, needs a human look._\n")
    a("| Confidence | Count | % |\n|---|---|---|")
    for r in confidence_breakdown:
        a(f"| {r['confidence']} | {r['n']:,} | {pct(r['n'], total_linkages)} |")
    a("")

    a("## 5. How linkages were detected\n")
    a("| Detection method | Count | % |\n|---|---|---|")
    for r in method_breakdown:
        a(f"| {r['detection_method']} | {r['n']:,} | {pct(r['n'], total_linkages)} |")
    a("\n_A linkage can be found in more than one field at once, so this column can add up to over 100%._\n")
    a("| Found in field | Count | % of linkages |\n|---|---|---|")
    for field_name, n in field_breakdown:
        a(f"| {field_name} | {n:,} | {pct(n, total_linkages)} |")
    a("")

    a("## 6. Most-referenced changes (likely hotspots / shared dependencies)\n")
    a("These are changes that other changes point at most often — good candidates for 'this touched a lot of things' or 'everyone depends on this'.\n")
    a("| # | Change | Status | Subject | Times referenced |\n|---|---|---|---|---|")
    for r in top_referenced:
        subj = (r["target_subject"] or "").replace("|", "/")[:70]
        a(f"| {r['target_number']} | #{r['target_number']} | {r['target_status']} | {subj} | {r['n']} |")
    a("")

    a("## 7. Changes that reference the most other changes\n")
    a("_Often merge/squash commits, stacked patch series, or changes that re-apply history (see the sample data: a single commit message can carry dozens of prior Change-Ids). Worth spot-checking whether these are genuine dependency chains or repository-migration noise._\n")
    a("| Change | Subject | Outgoing linkages |\n|---|---|---|")
    for r in top_sources:
        subj = (r["subject"] or "").replace("|", "/")[:70]
        a(f"| #{r['source_number']} | {subj} | {r['n']} |")
    a("")

    if unresolved_targets:
        a("## 8. Frequently-cited changes NOT found in this project's dataset\n")
        a("Either they belong to a different project/repo, or they weren't part of this retrieval run.\n")
        a("| Target change # | Times cited |\n|---|---|")
        for r in unresolved_targets:
            a(f"| {r['target_number']} | {r['n']} |")
        a("")

    if timeline:
        a("## 9. Changes created per month\n")
        a("| Month | Changes |\n|---|---|")
        for r in timeline:
            if r["ym"]:
                a(f"| {r['ym']} | {r['n']} |")
        a("")

    if keyword_breakdown:
        a("## 10. Developer reaction language (comments/log mentioning duplicate / depends-on / blocks / etc.)\n")
        a("| Keyword matched | Occurrences |\n|---|---|")
        for r in keyword_breakdown:
            a(f"| {r['matched_keyword']} | {r['n']} |")
        a("\nSee `reactions.csv` for the full list with authors, timestamps, and message snippets — this is the raw material for a 'how do developers actually respond to linkages' read (acknowledged & fixed vs. disputed vs. ignored vs. led to abandonment).\n")

    if flagged_examples:
        a("## 11. Sample of low-confidence linkages flagged for manual review\n")
        a("| Change | Raw match | Field | Context |\n|---|---|---|---|")
        for r in flagged_examples:
            ctx = (r["context_snippet"] or "").replace("\n", " ").replace("|", "/")[:100]
            a(f"| #{r['source_number']} | `{r['raw']}` | {r['source_fields']} | {ctx} |")
        a(f"\n(Showing 25 of {flagged:,} flagged linkages — query `linkages.csv` or the DB for the rest.)\n")

    a("## 12. Where to go for the full, unabridged data\n")
    a(f"- `{project.replace('/', '-')}.db` — SQLite database with **every** change, linkage, and reaction row. Open with `sqlite3`, DB Browser for SQLite, or pandas (`pd.read_sql`).")
    a("- `changes.csv` / `linkages.csv` / `reactions.csv` — the same data as flat files, one row per record, nothing aggregated away.")
    a("- `dashboard.html` — open in a browser to search/sort/page through every change and every linkage interactively.\n")

    if n_skipped:
        a("## Appendix: skipped folders (sample — full list in `skipped_dirs.log`)\n")
        if stats.dirs_no_data_files:
            a(f"**No recognised data file (skipped)** ({n_no_data}):")
            for name in stats.dirs_no_data_files[:25]:
                a(f"- {name}")
        if stats.duplicate_change_keys:
            a(f"\n**Duplicate change ids** ({n_dupe}):")
            for e in stats.duplicate_change_keys[:25]:
                a(f"- {e}")
        if stats.parse_errors:
            a(f"\n**Other errors** ({n_other}):")
            for e in stats.parse_errors[:25]:
                a(f"- {e}")
    if stats.dirs_unreadable_metadata:
        a(f"\n## Appendix: folders with corrupt/unreadable metadata.json (still ingested)\n")
        a("These folders had a `metadata.json` that failed to parse but were still ingested "
          "from their other data files (linkages.json / comments.json / patchsets.json). "
          "Metadata fields (status, owner, timestamps, etc.) will be NULL for these changes.\n")
        for e in stats.dirs_unreadable_metadata[:25]:
            a(f"- {e}")
        if len(stats.dirs_unreadable_metadata) > 25:
            a(f"\n_(and {len(stats.dirs_unreadable_metadata) - 25} more — see `skipped_dirs.log`)_")

    (report_dir / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# HTML dashboard (self-contained, loads two JSON files, client-side paging)
# ─────────────────────────────────────────────────────────────────────────────

DASHBOARD_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{project} — linkage &amp; change dashboard</title>
<style>
  :root {{
    --bg: #0f1115; --panel: #161922; --panel-2: #1d212c; --border: #2a2f3d;
    --text: #e7e9ee; --text-dim: #8b93a7; --accent: #5eb1ff; --accent-2: #ffb454;
    --good: #63d29b; --warn: #f2c14e; --bad: #ef6f6f; --mono: 'SFMono-Regular', Consolas, monospace;
  }}
  * {{ box-sizing: border-box; }}
  body {{ background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; margin:0; }}
  header {{ padding: 20px 28px; border-bottom: 1px solid var(--border); display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; }}
  header h1 {{ font-size: 18px; margin: 0; letter-spacing: .2px; }}
  header .sub {{ color: var(--text-dim); font-size: 12.5px; }}
  .stats {{ display:flex; gap:10px; padding: 14px 28px; flex-wrap: wrap; }}
  .stat {{ background: var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px 14px; min-width:120px; }}
  .stat b {{ display:block; font-size: 19px; font-family: var(--mono); }}
  .stat span {{ color: var(--text-dim); font-size: 11.5px; text-transform: uppercase; letter-spacing:.4px; }}
  .tabs {{ display:flex; gap:4px; padding: 0 28px; border-bottom: 1px solid var(--border); }}
  .tab {{ padding: 10px 16px; cursor:pointer; color: var(--text-dim); border-bottom: 2px solid transparent; font-size:13px; }}
  .tab.active {{ color: var(--text); border-color: var(--accent); }}
  .panel {{ padding: 16px 28px 40px; }}
  .panel.hidden {{ display:none; }}
  .toolbar {{ display:flex; gap:10px; margin-bottom:10px; flex-wrap:wrap; align-items:center; }}
  .toolbar .count {{ color: var(--text-dim); font-size: 12px; }}
  .toolbar button.clear {{ background: transparent; border:1px solid var(--border); color: var(--text-dim); padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; }}
  .toolbar button.clear:hover {{ color: var(--text); border-color: var(--accent); }}
  input[type=text] {{ background: var(--panel); border:1px solid var(--border); color: var(--text); padding:6px 8px; border-radius:5px; font-size:12px; width: 100%; }}
  select {{ background: var(--panel); border:1px solid var(--border); color: var(--text); padding:6px 6px; border-radius:5px; font-size:12px; width: 100%; }}
  table {{ width:100%; border-collapse: collapse; font-size: 12.8px; table-layout: fixed; }}
  thead th {{ position: sticky; top:0; background: var(--panel-2); text-align:left; padding:8px 8px 4px; cursor:pointer; border-bottom:1px solid var(--border); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; z-index:2; }}
  thead th:hover {{ color: var(--accent); }}
  thead th.sorted {{ color: var(--accent-2); }}
  thead tr.filters th {{ position: sticky; top: 30px; background: var(--panel-2); cursor: default; padding: 4px 8px 8px; z-index:1; }}
  tbody td {{ padding:7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }}
  tbody tr:hover {{ background: var(--panel); }}
  .mono {{ font-family: var(--mono); }}
  .pill {{ padding: 1px 7px; border-radius: 999px; font-size: 11px; border:1px solid var(--border); white-space:nowrap; }}
  .pill.high, .pill.MERGED {{ color: var(--good); border-color: var(--good); }}
  .pill.medium, .pill.NEW {{ color: var(--warn); border-color: var(--warn); }}
  .pill.low, .pill.ABANDONED {{ color: var(--bad); border-color: var(--bad); }}
  .ctx {{ color: var(--text-dim); }}
  .ctx-full {{ display: block; margin-top: 6px; padding: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; white-space: pre-wrap; color: var(--text); }}
  .hidden {{ display: none !important; }}
  a.expand {{ font-size: 11px; white-space: nowrap; }}
  .pager {{ display:flex; gap:8px; align-items:center; margin-top:12px; color: var(--text-dim); }}
  .pager button {{ background: var(--panel); border:1px solid var(--border); color: var(--text); padding:6px 10px; border-radius:6px; cursor:pointer; }}
  .pager button:disabled {{ opacity:.4; cursor:default; }}
  a {{ color: var(--accent); text-decoration:none; }}
  .note {{ color: var(--text-dim); font-size:12px; margin-bottom: 14px; }}
  .table-wrap {{ max-height: 70vh; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }}
</style>
</head>
<body>
<header>
  <h1>{project}</h1>
  <div class="sub">linkage &amp; change dashboard — generated from the full dataset, no rows omitted. Every column has its own filter below its header.</div>
</header>
<div class="stats" id="stats"></div>
<div class="tabs">
  <div class="tab active" data-tab="linkages">Linkages ({n_linkages})</div>
  <div class="tab" data-tab="changes">Changes ({n_changes})</div>
</div>

<div class="panel" id="panel-linkages">
  <div class="note">Every detected linkage. Click a header to sort; use the row of boxes right under the headers to filter each field independently (dropdowns for fields with a small set of values, text boxes for free-form ones like the raw match or context).</div>
  <div class="toolbar"><button class="clear" id="lk-clear">Clear all filters</button><span class="count" id="lk-count"></span></div>
  <div class="table-wrap"><table id="lk-table"></table></div>
  <div class="pager" id="lk-pager"></div>
</div>

<div class="panel hidden" id="panel-changes">
  <div class="note">Every change. Click a header to sort; use the row of boxes right under the headers to filter each field independently.</div>
  <div class="toolbar"><button class="clear" id="ch-clear">Clear all filters</button><span class="count" id="ch-count"></span></div>
  <div class="table-wrap"><table id="ch-table"></table></div>
  <div class="pager" id="ch-pager"></div>
</div>

<script>
const PAGE_SIZE = 100;
const MAX_SELECT_OPTIONS = 60; // fields with more distinct values than this fall back to a text filter

function esc(s) {{ return (s===null||s===undefined) ? '' : String(s).replace(/[&<>]/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;'}}[c])); }}
function pill(v) {{ return (v===null||v===undefined||v==='') ? '' : `<span class="pill ${{v}}">${{esc(v)}}</span>`; }}
function yesno(v) {{ return v ? 'yes' : 'no'; }}

// hash -> full (untruncated) linkage context, loaded from contexts.json.
// Populated once at load time; the Context column looks values up in here
// so the full text can be revealed in place without re-fetching anything.
let CONTEXTS = {{}};
function toggleContext(rid) {{
  const short = document.getElementById(rid + '-short');
  const full = document.getElementById(rid + '-full');
  if (!short || !full) return;
  short.classList.toggle('hidden');
  full.classList.toggle('hidden');
}}

// ── column definitions ──────────────────────────────────────────────────────
// type 'auto'  -> dropdown if the data has few distinct values, else free text
// type 'text'  -> always a free-text substring filter
// valueOf(row) -> value used for filtering/sorting/the dropdown options
// html(row)    -> what's rendered in the cell (defaults to esc(valueOf(row)))

const LK_COLUMNS = [
  {{key:'source_number', label:'Source', type:'auto', valueOf:r=>r.source_number!==null&&r.source_number!==undefined ? r.source_number : (r.source_change_key||''), width:'120px',
    html:r=>r.source_number!==null&&r.source_number!==undefined
      ? `<a href="#" class="mono" onclick="jumpToChange(${{r.source_number}});return false;">#${{r.source_number}}</a>`
      : `<span class="mono" title="${{esc(r.source_change_key)}}">${{esc(r.source_change_key)}}</span>`}},
  {{key:'target_number', label:'Target #', type:'auto', valueOf:r=>r.target_number, width:'80px',
    html:r=>r.target_number ? `<span class="mono">#${{r.target_number}}</span>` : ''}},
  {{key:'target_status', label:'Target status', type:'auto', valueOf:r=>r.target_status||'', html:r=>pill(r.target_status), width:'90px'}},
  {{key:'detection_method', label:'Method', type:'auto', valueOf:r=>r.detection_method||'', width:'90px'}},
  {{key:'confidence', label:'Confidence', type:'auto', valueOf:r=>r.confidence||'', html:r=>pill(r.confidence), width:'90px'}},
  {{key:'source_fields', label:'Found in field(s)', type:'multi', valueOf:r=>r.source_fields||'', width:'130px',
    splitValue:r=>(r.source_fields ? r.source_fields.split(', ').filter(Boolean) : [])}},
  {{key:'host', label:'Host', type:'auto', valueOf:r=>r.host||'', width:'120px'}},
  {{key:'is_external', label:'External', type:'auto', valueOf:r=>yesno(r.is_external), width:'70px'}},
  {{key:'flag_for_review', label:'Flagged', type:'auto', valueOf:r=>yesno(r.flag_for_review), width:'70px'}},
  {{key:'target_resolved', label:'Target in dataset', type:'auto', valueOf:r=>yesno(r.target_resolved), width:'110px'}},
  {{key:'patchset', label:'Patchset', type:'auto', valueOf:r=>r.patchset===null||r.patchset===undefined?'':r.patchset, width:'70px'}},
  {{key:'raw', label:'Raw match', type:'text', valueOf:r=>r.raw||'', html:r=>`<span class="mono">${{esc(r.raw)}}</span>`, width:'160px'}},
  {{key:'target_subject', label:'Target subject', type:'text', valueOf:r=>r.target_subject||''}},
  {{key:'context_snippet', label:'Context', type:'text', valueOf:r=>r.context_snippet||'',
    html:r=>{{
      const full = r.context_hash ? CONTEXTS[r.context_hash] : null;
      if (!full || full === r.context_snippet) {{
        return `<span class="ctx">${{esc(r.context_snippet)}}</span>`;
      }}
      const rid = 'ctx-' + r.linkage_id;
      return `<span class="ctx" id="${{rid}}-short">${{esc(r.context_snippet)}} ` +
        `<a href="#" class="expand" onclick="toggleContext('${{rid}}');return false;">show full context ▾</a></span>` +
        `<span class="ctx ctx-full hidden" id="${{rid}}-full">${{esc(full)}} ` +
        `<a href="#" class="expand" onclick="toggleContext('${{rid}}');return false;">show less ▴</a></span>`;
    }}}},
];

const CH_COLUMNS = [
  {{key:'number', label:'#', type:'auto', valueOf:r=>r.number, html:r=>`<span class="mono">#${{r.number}}</span>`, width:'80px'}},
  {{key:'status', label:'Status', type:'auto', valueOf:r=>r.status||'', html:r=>pill(r.status), width:'90px'}},
  {{key:'subject', label:'Subject', type:'text', valueOf:r=>r.subject||''}},
  {{key:'owner_name', label:'Owner', type:'auto', valueOf:r=>r.owner_name||'', width:'120px'}},
  {{key:'submitter_name', label:'Submitter', type:'auto', valueOf:r=>r.submitter_name||'', width:'120px'}},
  {{key:'created', label:'Created', type:'text', valueOf:r=>(r.created||'').slice(0,10), width:'90px'}},
  {{key:'num_patchsets', label:'Patchsets', type:'auto', valueOf:r=>r.num_patchsets, width:'80px'}},
  {{key:'num_linkages_out', label:'Links out', type:'auto', valueOf:r=>r.num_linkages_out, width:'80px'}},
  {{key:'num_linkages_in', label:'Links in', type:'auto', valueOf:r=>r.num_linkages_in, width:'80px'}},
  {{key:'num_change_comments', label:'Comments', type:'auto', valueOf:r=>r.num_change_comments, width:'80px'}},
  {{key:'num_inline_comments', label:'Inline', type:'auto', valueOf:r=>r.num_inline_comments, width:'80px'}},
];

function buildTable(name, tableId, bodyless, columns, pagerId, countId, clearId) {{
  let data = [];
  let filtered = [];
  let page = 0;
  let sortKey = null, sortDir = 1;
  const filterState = {{}}; // key -> current filter value (string)
  const colTypes = {{}};    // key -> 'select' | 'text' (resolved once data is known)

  const table = document.getElementById(tableId);

  function distinctValues(key) {{
    const s = new Set();
    for (const r of data) {{
      const col = columns.find(c => c.key === key);
      s.add(String(col.valueOf(r)));
      if (s.size > MAX_SELECT_OPTIONS) return null; // too many -> use text filter
    }}
    return Array.from(s).sort();
  }}

  function distinctMultiValues(key) {{
    const col = columns.find(c => c.key === key);
    const s = new Set();
    for (const r of data) {{
      for (const v of col.splitValue(r)) s.add(v);
    }}
    return Array.from(s).sort();
  }}

  function buildHeader() {{
    const headRow = document.createElement('tr');
    const filterRow = document.createElement('tr');
    filterRow.className = 'filters';
    columns.forEach(col => {{
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.k = col.key;
      th.addEventListener('click', () => {{
        sortDir = (sortKey === col.key) ? -sortDir : 1;
        sortKey = col.key;
        table.querySelectorAll('thead th').forEach(x => x.classList.remove('sorted'));
        th.classList.add('sorted');
        applyFilters();
      }});
      if (col.width) th.style.width = col.width;
      headRow.appendChild(th);

      const fth = document.createElement('th');
      let resolvedType = col.type;
      if (col.type === 'auto') {{
        const opts = distinctValues(col.key);
        resolvedType = opts ? 'select' : 'text';
        colTypes[col.key] = {{type: resolvedType, options: opts}};
      }} else if (col.type === 'multi') {{
        // e.g. "Found in field(s)": each row can have several values at once
        // (GerritLinkage.sourceFields is string[]), so the dropdown is built
        // from the union of individual values, and a row matches if the
        // selected value is ANY ONE of its values — not an exact full match.
        colTypes[col.key] = {{type: 'multi', options: distinctMultiValues(col.key)}};
      }} else {{
        colTypes[col.key] = {{type: 'text', options: null}};
      }}
      if (colTypes[col.key].type === 'select' || colTypes[col.key].type === 'multi') {{
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">(all)</option>' +
          colTypes[col.key].options.map(v => `<option value="${{esc(v)}}">${{esc(v) || '(blank)'}}</option>`).join('');
        sel.addEventListener('change', () => {{ filterState[col.key] = sel.value; applyFilters(); }});
        fth.appendChild(sel);
      }} else {{
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'filter…';
        inp.addEventListener('input', () => {{ filterState[col.key] = inp.value.toLowerCase(); applyFilters(); }});
        fth.appendChild(inp);
      }}
      filterRow.appendChild(fth);
    }});
    const thead = document.createElement('thead');
    thead.appendChild(headRow);
    thead.appendChild(filterRow);
    table.innerHTML = '';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    tbody.id = tableId + '-body';
    table.appendChild(tbody);
  }}

  function matchesRow(r) {{
    for (const col of columns) {{
      const fv = filterState[col.key];
      if (!fv) continue;
      const ctype = colTypes[col.key] ? colTypes[col.key].type : 'text';
      if (ctype === 'multi') {{
        const values = col.splitValue(r).map(v => v.toLowerCase());
        if (!values.includes(fv.toLowerCase())) return false;
        continue;
      }}
      const rv = String(col.valueOf(r)).toLowerCase();
      if (ctype === 'select') {{
        if (rv !== fv.toLowerCase()) return false;
      }} else {{
        if (!rv.includes(fv)) return false;
      }}
    }}
    return true;
  }}

  function render() {{
    const tbody = document.getElementById(tableId + '-body');
    const start = page * PAGE_SIZE;
    const rows = filtered.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = rows.map(r => '<tr>' + columns.map(col =>
      `<td>${{col.html ? col.html(r) : esc(col.valueOf(r))}}</td>`).join('') + '</tr>').join('');
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    document.getElementById(pagerId).innerHTML =
      `<button ${{page<=0?'disabled':''}} id="${{pagerId}}-prev">‹ prev</button>` +
      `<span>page ${{page+1}} / ${{pages}}</span>` +
      `<button ${{page>=pages-1?'disabled':''}} id="${{pagerId}}-next">next ›</button>`;
    document.getElementById(pagerId + '-prev').onclick = () => {{ if (page>0) {{ page--; render(); }} }};
    document.getElementById(pagerId + '-next').onclick = () => {{ if (page<pages-1) {{ page++; render(); }} }};
    document.getElementById(countId).textContent = `${{filtered.length.toLocaleString()}} / ${{data.length.toLocaleString()}} rows shown`;
  }}

  function applyFilters() {{
    filtered = data.filter(matchesRow);
    if (sortKey) {{
      const col = columns.find(c => c.key === sortKey);
      filtered.sort((a,b) => {{
        const av = col.valueOf(a), bv = col.valueOf(b);
        if (av === bv) return 0;
        if (av === null || av === undefined || av === '') return 1;
        if (bv === null || bv === undefined || bv === '') return -1;
        return (av > bv ? 1 : -1) * sortDir;
      }});
    }}
    page = 0;
    render();
  }}

  document.getElementById(clearId).addEventListener('click', () => {{
    Object.keys(filterState).forEach(k => delete filterState[k]);
    table.querySelectorAll('select').forEach(s => s.value = '');
    table.querySelectorAll('input[type=text]').forEach(i => i.value = '');
    applyFilters();
  }});

  return {{
    setData(d) {{ data = d; buildHeader(); applyFilters(); }},
    jumpFilter(key, value) {{
      filterState[key] = String(value).toLowerCase();
      const idx = columns.findIndex(c => c.key === key);
      const fth = table.querySelectorAll('thead tr.filters th')[idx];
      const el = fth.querySelector('select,input');
      if (el) el.value = value;
      applyFilters();
    }},
  }};
}}

const lkCtrl = buildTable('lk', 'lk-table', true, LK_COLUMNS, 'lk-pager', 'lk-count', 'lk-clear');
const chCtrl = buildTable('ch', 'ch-table', true, CH_COLUMNS, 'ch-pager', 'ch-count', 'ch-clear');

function jumpToChange(number) {{
  document.querySelector('.tab[data-tab="changes"]').click();
  chCtrl.jumpFilter('number', number);
}}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('panel-linkages').classList.toggle('hidden', t.dataset.tab !== 'linkages');
  document.getElementById('panel-changes').classList.toggle('hidden', t.dataset.tab !== 'changes');
}}));

Promise.all([
  fetch('linkages.json').then(r => r.json()),
  fetch('changes.json').then(r => r.json()),
  fetch('contexts.json').then(r => r.json()),
]).then(([linkages, changes, contexts]) => {{
  CONTEXTS = contexts;
  lkCtrl.setData(linkages);
  chCtrl.setData(changes);
  document.getElementById('stats').innerHTML = {stats_html};
}}).catch(err => {{
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="padding:16px;background:#3a1f1f;color:#ffb4b4">Could not load linkages.json / changes.json / contexts.json. ' +
    'Browsers block fetch() on local files opened directly — run <code>python3 -m http.server</code> ' +
    'inside the report folder and open http://localhost:8000/dashboard.html instead.</div>');
  console.error(err);
}});
</script>
</body>
</html>
"""


def build_dashboard(db_path: Path, project: str, report_dir: Path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    linkages = [dict(r) for r in c.execute("SELECT * FROM linkages").fetchall()]
    changes = [dict(r) for r in c.execute("SELECT * FROM changes").fetchall()]
    contexts = {
        r["context_hash"]: r["context_full"]
        for r in c.execute("SELECT * FROM contexts").fetchall()
    }

    (report_dir / "linkages.json").write_text(json.dumps(linkages), encoding="utf-8")
    (report_dir / "changes.json").write_text(json.dumps(changes), encoding="utf-8")
    (report_dir / "contexts.json").write_text(json.dumps(contexts), encoding="utf-8")

    n_changes = len(changes)
    n_linkages = len(linkages)
    n_flagged = sum(1 for l in linkages if l.get("flag_for_review"))
    n_resolved = sum(1 for l in linkages if l.get("target_resolved"))
    n_external = sum(1 for l in linkages if l.get("is_external"))

    stat_defs = [
        (n_changes, "changes"), (n_linkages, "linkages"),
        (n_resolved, "resolved in-project"), (n_external, "external"),
        (n_flagged, "flagged for review"),
    ]
    stats_html = "".join(
        f'<div class="stat"><b>{v:,}</b><span>{label}</span></div>' for v, label in stat_defs
    )

    html = DASHBOARD_TEMPLATE.format(
        project=project, n_linkages=n_linkages, n_changes=n_changes,
        stats_html=json.dumps(stats_html),
    )
    (report_dir / "dashboard.html").write_text(html, encoding="utf-8")
    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def discover_projects(output_dir: Path) -> list[str]:
    return [p.name for p in sorted(output_dir.iterdir()) if p.is_dir()]


def run_one(output_dir: Path, project: str, report_root: Path):
    safe_name = project.replace("/", "-")
    report_dir = report_root / safe_name
    report_dir.mkdir(parents=True, exist_ok=True)
    db_path = report_dir / f"{safe_name}.db"

    print(f"\n=== {project} ===")
    print(f"Ingesting from {output_dir / project} ...")
    stats = ingest_project(output_dir, project, db_path)
    print(f"  subfolders found: {stats.total_subdirs:,}")
    print(f"  changes ingested: {stats.total_changes:,}  linkages: {stats.total_linkages:,}  reactions: {stats.total_reactions:,}")
    if stats.dirs_no_data_files:
        print(f"  ! {len(stats.dirs_no_data_files)} subfolders had no recognised data file (skipped)")
    if stats.dirs_unreadable_metadata:
        print(f"  ! {len(stats.dirs_unreadable_metadata)} subfolders had unreadable/corrupt metadata.json "
              f"(still ingested from other files — metadata fields will be NULL)")
    if stats.duplicate_change_keys:
        print(f"  ! {len(stats.duplicate_change_keys)} subfolders were duplicate change_ids of another folder")
    if stats.parse_errors:
        print(f"  ! {len(stats.parse_errors)} change folders had other errors (see summary.md appendix)")

    loggable = (len(stats.dirs_no_data_files) + len(stats.dirs_unreadable_metadata)
                + len(stats.duplicate_change_keys) + len(stats.parse_errors))
    if loggable:
        log_path = report_dir / "skipped_dirs.log"
        with log_path.open("w", encoding="utf-8") as f:
            f.write(f"Subfolders found under project dir: {stats.total_subdirs}\n")
            f.write(f"Successfully ingested as changes:   {stats.total_changes}\n\n")
            if stats.dirs_no_data_files:
                f.write(f"--- {len(stats.dirs_no_data_files)} folders with NO recognised data file (SKIPPED) ---\n")
                f.write("\n".join(stats.dirs_no_data_files) + "\n\n")
            if stats.dirs_unreadable_metadata:
                f.write(f"--- {len(stats.dirs_unreadable_metadata)} folders with UNREADABLE/CORRUPT metadata.json "
                        f"(still ingested from other files) ---\n")
                f.write("\n".join(stats.dirs_unreadable_metadata) + "\n\n")
            if stats.duplicate_change_keys:
                f.write(f"--- {len(stats.duplicate_change_keys)} folders that DUPLICATED another folder's change id ---\n")
                f.write("\n".join(stats.duplicate_change_keys) + "\n\n")
            if stats.parse_errors:
                f.write(f"--- {len(stats.parse_errors)} folders with OTHER errors ---\n")
                f.write("\n".join(stats.parse_errors) + "\n\n")
        print(f"  full list of every skipped folder and why -> {log_path}")

    print("Exporting CSVs ...")
    export_csv(db_path, report_dir)
    print("Writing summary.md ...")
    build_summary(db_path, project, report_dir, stats)
    print("Building dashboard.html ...")
    build_dashboard(db_path, project, report_dir)
    print(f"Done -> {report_dir}/")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output-dir", required=True, type=Path, help="path to your 'output' directory")
    ap.add_argument("--project", help="project folder name, e.g. 'ccsdk/sli' or 'ccsdk-sli'")
    ap.add_argument("--all", action="store_true", help="process every project folder under --output-dir")
    ap.add_argument("--report-dir", type=Path, default=Path("./reports"), help="where to write reports (default ./reports)")
    args = ap.parse_args()

    if not args.output_dir.is_dir():
        ap.error(f"{args.output_dir} is not a directory")
    if not args.project and not args.all:
        ap.error("pass --project <name> or --all")

    projects = discover_projects(args.output_dir) if args.all else [args.project]
    for project in projects:
        run_one(args.output_dir, project, args.report_dir)


if __name__ == "__main__":
    main()