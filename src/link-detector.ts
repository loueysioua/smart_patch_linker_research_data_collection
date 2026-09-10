import type { GerritLinkage, ConfidenceLevel } from "./types";

// ─── String utilities ─────────────────────────────────────────────────────────

/**
 * Escapes regex special characters in a literal string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips the protocol and trailing slashes from a URL so we can compare
 * just the host-and-path portion.
 */
function getHostAndPath(url: string): string {
  let clean = url.replace(/^https?:\/\//i, "");
  clean = clean.replace(/\/+$/, "");
  return clean;
}

/**
 * Reassembles URLs that have been split across lines in a comment.
 */
function preProcessSplitUrls(text: string): string {
  return text.replace(
    /(\bhttps?:\/\/[^\s]+?\/c\/|\b\/c\/|\b#\/c\/|\b\/c\/.*?\/\+\/)\s*\n\s*(\d+|\w+)/g,
    "$1$2",
  );
}

/**
 * Trims trailing punctuation that might be matched as part of a URL but is
 * actually comment punctuation.
 */
function cleanTrailingPunctuation(str: string): string {
  return str.replace(/[.,;:!?]+$/, "");
}

// ─── Text-region masking ──────────────────────────────────────────────────────

/**
 * Returns a copy of `text` where the character range [start, end) has been
 * replaced with space characters of the same length.  Preserving the length
 * keeps all other `lastIndex` values valid so subsequent regex passes over the
 * same string see the correct positions.
 */
function maskRegion(text: string, start: number, end: number): string {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

// ─── URL / Hyperlink format ──────────────────────────────────────

/**
 * Extracts Gerrit change linkages from absolute and relative URL patterns in
 * the given text.  Returns the linkages **and** a masked copy of the text
 * (consumed URL spans replaced with spaces) so that later detectors do not
 * accidentally re-parse the same characters.
 *
 * Confidence rule:
 *  - Absolute URL whose host matches the configured Gerrit instance → `"high"`
 *  - Absolute URL pointing to a different Gerrit host (external)    → `"high"`
 *  - Relative path-only URL fragment                                 → `"high"`
 *
 * @param text         The raw source text to parse (after split-URL normalisation).
 * @param baseUrl      Base URL of the target Gerrit instance.
 * @param sourceField  The field type where this text was found.
 * @param contextText  The original context/message block for reference.
 */
export function extractLinkages(
  text: string,
  baseUrl: string,
  sourceField: GerritLinkage["sourceFields"][number],
  contextText: string,
): { linkages: GerritLinkage[]; maskedText: string } {
  const linkages: GerritLinkage[] = [];
  if (!text) return { linkages, maskedText: text };

  // Pre-process split URLs before any regex pass.
  let workingText = preProcessSplitUrls(text);

  // ── Absolute URLs ──────────────────────────────────────────────────────────
  // NOTE: two fixes vs. the original regex:
  //  1. `(?:\/[a-zA-Z0-9_-]+)*?` before `/c/` — tolerates a reverse-proxy path
  //     prefix (e.g. gerrit.onap.org serves the UI under "/r/", so real links
  //     look like ".../r/c/oom/+/99856", not ".../c/oom/+/99856").
  //  2. `\/\+\/` instead of `\/+\/` — the "+" separator in modern Gerrit URLs
  //     ("project/+/number") must be escaped as a literal character. Written
  //     unescaped, `+` is a regex quantifier meaning "one or more slashes",
  //     which never matches a real URL, so the project group (and therefore
  //     the whole match) silently failed on every "/+/"-style link.
  const absRe =
    /https?:\/\/([a-zA-Z0-9.-]+)(?:\/[a-zA-Z0-9_-]+)*?\/(?:#\/)?c\/(?:(.*?)\/\+\/)?(\d+)(?:\/(\d+))?(?:\/([a-zA-Z0-9_.\-/+@%]+))?/gi;

  let match: RegExpExecArray | null;
  while ((match = absRe.exec(workingText)) !== null) {
    const rawMatch = match[0];
    const host = match[1];
    const project = match[2] || null;
    const changeNumber = parseInt(match[3], 10);
    const patchset = match[4] ? parseInt(match[4], 10) : null;

    const cleanedRaw = cleanTrailingPunctuation(rawMatch);
    const targetHostPath = getHostAndPath(baseUrl).toLowerCase();
    const isExternal = !cleanedRaw.toLowerCase().includes(targetHostPath);

    linkages.push({
      raw: cleanedRaw,
      host,
      changeNumber,
      project,
      patchset,
      sourceFields: [sourceField],
      context: contextText.trim(),
      isExternal,
      changeId: null,
      detectionMethod: "url",
      confidence: "high",
      flagForReview: false,
    });

    // Mask consumed region (use raw match length to keep positions stable).
    workingText = maskRegion(
      workingText,
      match.index,
      match.index + rawMatch.length,
    );
  }

  // ── Relative / informal URLs ───────────────────────────────────────────────
  // Same `\/\+\/` fix as absRe above — the literal "+" in "project/+/number"
  // must be escaped, otherwise it's read as a slash-quantifier and never matches.
  const relativeRegex =
    /(?:^|[\s'"` <>(\[])((#\/c\/|\/#\/c\/|\/c\/)(?:(.*?)\/\+\/)?(\d+)(?:\/(\d+))?(?:\/([a-zA-Z0-9_.\-/+@%]+))?)/gi;

  while ((match = relativeRegex.exec(workingText)) !== null) {
    const fullSegment = match[1];
    const changeNumber = parseInt(match[4], 10);
    const patchset = match[5] ? parseInt(match[5], 10) : null;
    const project = match[3] || null;
    const cleanedRaw = cleanTrailingPunctuation(fullSegment);

    linkages.push({
      raw: cleanedRaw,
      host: null,
      changeNumber,
      project,
      patchset,
      sourceFields: [sourceField],
      context: contextText.trim(),
      isExternal: false,
      changeId: null,
      detectionMethod: "url",
      confidence: "high",
      flagForReview: false,
    });

    // Mask the path segment only, preserving the leading whitespace
    const segStart = match.index + (match[0].length - fullSegment.length);
    workingText = maskRegion(
      workingText,
      segStart,
      segStart + fullSegment.length,
    );
  }

  // ── Intra-format deduplication ─────────────────────────────────────────────
  const seen = new Map<string, GerritLinkage>();
  for (const l of linkages) {
    const key = `${l.changeNumber}-${l.project ?? ""}-${l.patchset ?? ""}-${l.raw}-${l.isExternal}`;
    if (
      !seen.has(key) &&
      Number.isInteger(l.changeNumber) &&
      l.changeNumber > 0
    ) {
      seen.set(key, l);
    }
  }
  const uniqueLinkages = [...seen.values()];

  return { linkages: uniqueLinkages, maskedText: workingText };
}

// ─── Change ID format ────────────────────────────────────────────

/** Full 41-character Gerrit Change ID: uppercase I + exactly 40 hex chars. */
const FULL_CHANGE_ID_RE = /\bI([0-9a-f]{40})\b/gi;

/** Abbreviated form: uppercase I + 7–12 hex chars (lower confidence). */
const ABBR_CHANGE_ID_RE = /\bI([0-9a-f]{7,12})\b/gi;

/**
 * Structured Git/Gerrit trailers found in commit message footers.
 * A trailer is a line of the form `Key: value` after the first blank line
 * that follows the message body.
 */
export interface CommitFooter {
  key: string;
  value: string;
}

/**
 * Parses the Git trailer block from a commit message.
 * Trailers are the lines after the last blank line before the end of the
 * message.
 *
 * Returns an array of { key, value } pairs.
 */
export function parseCommitFooters(commitMessage: string): CommitFooter[] {
  const lines = commitMessage.split("\n");
  const footers: CommitFooter[] = [];

  // Walk backwards to find the trailing block (contiguous non-blank lines at end).
  let trailingStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "") break;
    trailingStart = i;
  }

  const trailerRe = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/;
  for (let i = trailingStart; i < lines.length; i++) {
    const m = trailerRe.exec(lines[i]);
    if (m) {
      footers.push({ key: m[1], value: m[2].trim() });
    }
  }

  return footers;
}

/**
 * Extracts Gerrit Change-ID linkages from a text block and returns both the
 * linkages and a masked copy of the text so the subsequent bare-number detector
 * does not re-parse the same token.
 *
 * Confidence rules:
 *  - `Depends-On:` commit trailer    → `"high"`
 *  - Full 41-char Change-ID (I+40h)  → `"high"`
 *  - Abbreviated Change-ID (I+7-12h) → `"low"` + `flagForReview: true`
 *
 * @param text           Raw text to scan.
 * @param sourceField    Which text field this came from.
 * @param contextText    Full message for the context field.
 * @param ownChangeId    The current change's own Change-Id (to skip self-refs).
 */
export function extractChangeIdLinkages(
  text: string,
  sourceField: GerritLinkage["sourceFields"][number],
  contextText: string,
  ownChangeId: string | null = null,
): { linkages: GerritLinkage[]; maskedText: string } {
  if (!text) return { linkages: [], maskedText: text };

  const linkages: GerritLinkage[] = [];
  const normalizedOwnId = ownChangeId?.toLowerCase() ?? null;
  let workingText = text;

  // 1. Depends-On: trailers — always a high-confidence linkage.
  if (sourceField === "commit_message") {
    const footers = parseCommitFooters(text);
    for (const footer of footers) {
      if (footer.key.toLowerCase() === "depends-on") {
        const depValue = footer.value.trim();
        const fullMatch = /^I([0-9a-f]{40})$/i.exec(depValue);
        if (fullMatch) {
          const changeId = "I" + fullMatch[1].toLowerCase();
          if (changeId !== normalizedOwnId) {
            linkages.push({
              raw: footer.value,
              host: null,
              changeNumber: 0,
              project: null,
              patchset: null,
              sourceFields: [sourceField],
              context: contextText.trim(),
              isExternal: false,
              changeId,
              detectionMethod: "change_id",
              confidence: "high",
              flagForReview: false,
            });
            // Mask the value inside the working text so the regex pass below
            // won't double-count the same hash.
            const idx = workingText.indexOf(footer.value);
            if (idx !== -1) {
              workingText = maskRegion(
                workingText,
                idx,
                idx + footer.value.length,
              );
            }
          }
        }
      }
    }
  }

  // 2. Free-text scan for full 41-char Change IDs (high confidence).
  FULL_CHANGE_ID_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FULL_CHANGE_ID_RE.exec(workingText)) !== null) {
    const changeId = "I" + match[1].toLowerCase();
    if (changeId === normalizedOwnId && sourceField === "commit_message")
      continue;

    linkages.push({
      raw: match[0],
      host: null,
      changeNumber: 0,
      project: null,
      patchset: null,
      sourceFields: [sourceField],
      context: contextText.trim(),
      isExternal: false,
      changeId,
      detectionMethod: "change_id",
      confidence: "high",
      flagForReview: false,
    });

    workingText = maskRegion(
      workingText,
      match.index,
      match.index + match[0].length,
    );
    // Reset so maskRegion does not confuse lastIndex.
    FULL_CHANGE_ID_RE.lastIndex = match.index;
  }

  // 3. Free-text scan for abbreviated Change IDs (low confidence, flag for review).
  ABBR_CHANGE_ID_RE.lastIndex = 0;
  while ((match = ABBR_CHANGE_ID_RE.exec(workingText)) !== null) {
    const abbr = match[0];
    // Skip if already covered by a full Change-ID in the same linkage list.
    const alreadyCovered = linkages.some(
      (l) => l.changeId !== null && l.changeId.startsWith(abbr.toLowerCase()),
    );
    if (alreadyCovered) continue;

    const changeId = abbr.toLowerCase();
    if (changeId === normalizedOwnId?.slice(0, abbr.length)) continue;

    linkages.push({
      raw: abbr,
      host: null,
      changeNumber: 0,
      project: null,
      patchset: null,
      sourceFields: [sourceField],
      context: contextText.trim(),
      isExternal: false,
      changeId,
      detectionMethod: "change_id",
      confidence: "low",
      flagForReview: true,
    });

    workingText = maskRegion(
      workingText,
      match.index,
      match.index + match[0].length,
    );
    ABBR_CHANGE_ID_RE.lastIndex = match.index;
  }

  // Intra-format deduplication by changeId only (sourceFields merged below).
  const seen = new Map<string, GerritLinkage>();
  for (const l of linkages) {
    const key = `${l.changeId}`;
    if (!seen.has(key)) {
      seen.set(key, l);
    }
  }
  const uniqueLinkages = [...seen.values()];

  return { linkages: uniqueLinkages, maskedText: workingText };
}

// ─── Phase 3.2 — Review Number format ────────────────────────────────────────

/**
 * Proximity window (characters) to search in either direction of a candidate
 * number for a trigger phrase.
 */
const PROXIMITY_CHARS = 50;

/**
 * Strong trigger phrases — high confidence the number is a patch reference.
 */
const STRONG_TRIGGERS: readonly string[] = [
  "change",
  "patch",
  "review",
  "patchset",
  "patch set",
  "cl",
  "similar to",
  "duplicate of",
  "same as",
  "related to",
  "replaced by",
  "replaces",
  "supersedes",
  "superseded by",
  "depends on",
  "dependency",
  "blocked by",
  "blocks",
  "see also",
  "see",
  "cf.",
  "fixes",
  "fixed in",
  "addressed in",
];

/**
 * Weak trigger phrases — use only with an otherwise clean context.
 */
const WEAK_TRIGGERS: readonly string[] = ["like", "similar", "referenced"];

/**
 * Exclusion patterns — if any of these appear immediately before or near the
 * number it is almost certainly NOT a Gerrit change reference.
 */
const EXCLUSION_PATTERNS: readonly RegExp[] = [
  /\bbug\s*#?\s*$/i,
  /\bissue\s*#?\s*$/i,
  /\bticket\s*#?\s*$/i,
  /\blp\s*:\s*$/i, // Launchpad
  /\bbz\s*:\s*$/i, // Bugzilla
  /\bjira[-\s]\s*$/i, // Jira
  /\bline\s+$/i,
  /\blines?\s+$/i,
  /\bcol(?:umn)?\s+$/i,
  /\bv(?:ersion)?\s*$/i,
  /\d+\.\s*$/, // decimal number like "1." before another number
  /#\s*$/, // bare hash — likely a bug/issue tracker marker
];

/**
 * Returns true if the text window immediately preceding the number match
 * contains any exclusion marker.
 */
function isExcluded(leftContext: string): boolean {
  return EXCLUSION_PATTERNS.some((re) => re.test(leftContext));
}

/**
 * Returns whether a trigger phrase is found within `PROXIMITY_CHARS`
 * characters of the given position, and whether it is a strong or weak trigger.
 */
function findTriggerInContext(
  text: string,
  matchStart: number,
  matchEnd: number,
): { found: boolean; strong: boolean } {
  const windowLeft = text
    .slice(Math.max(0, matchStart - PROXIMITY_CHARS), matchStart)
    .toLowerCase();
  const windowRight = text
    .slice(matchEnd, Math.min(text.length, matchEnd + PROXIMITY_CHARS))
    .toLowerCase();

  for (const trigger of STRONG_TRIGGERS) {
    if (windowLeft.includes(trigger) || windowRight.includes(trigger)) {
      return { found: true, strong: true };
    }
  }
  for (const trigger of WEAK_TRIGGERS) {
    if (windowLeft.includes(trigger) || windowRight.includes(trigger)) {
      return { found: true, strong: false };
    }
  }
  return { found: false, strong: false };
}

/**
 * Extracts Gerrit change linkages from bare numbers in a text block.
 *
 * Should be called **after** `extractLinkages` and `extractChangeIdLinkages`
 * have been run and their masked texts merged, so that URL and Change-ID spans
 * are already blanked out.
 *
 * Confidence rules:
 *  - Strong trigger phrase found → `"medium"` (API validation still required)
 *  - Weak trigger phrase found   → `"low"` + `flagForReview: true`
 *
 * @param text         The masked source text (URLs / Change-IDs already blanked).
 * @param sourceField  Which field this text came from.
 * @param contextText  The full original message text used as the context field.
 */
// export function extractNumberLinkages(
//   text: string,
//   sourceField: GerritLinkage["sourceField"],
//   contextText: string,
// ): GerritLinkage[] {
//   if (!text) return [];

//   const linkages: GerritLinkage[] = [];

//   // Match any standalone positive integer not immediately preceded by / \ #
//   // (those are already masked but the lookbehind is kept as a safety net).
//   const numberRegex = /(?<![/\\#])\b(\d{3,7})\b(?!\s*\.\d)/g;

//   let match: RegExpExecArray | null;
//   while ((match = numberRegex.exec(text)) !== null) {
//     const raw = match[1];
//     const changeNumber = parseInt(raw, 10);
//     const matchStart = match.index;
//     const matchEnd = match.index + raw.length;

//     const leftContext = text.slice(
//       Math.max(0, matchStart - PROXIMITY_CHARS),
//       matchStart,
//     );
//     if (isExcluded(leftContext)) continue;

//     const { found, strong } = findTriggerInContext(text, matchStart, matchEnd);
//     if (!found) continue;

//     const confidence: ConfidenceLevel = strong ? "medium" : "low";

//     linkages.push({
//       raw,
//       host: null,
//       changeNumber,
//       project: null,
//       patchset: null,
//       sourceField,
//       context: contextText.trim(),
//       isExternal: false,
//       changeId: null,
//       detectionMethod: "number",
//       confidence,
//       flagForReview: !strong,
//     });
//   }

//   // Intra-format deduplication by change number + source field.
//   const seen = new Set<string>();
//   return linkages.filter((l) => {
//     const key = `${l.changeNumber}-${l.sourceField}`;
//     if (seen.has(key)) return false;
//     seen.add(key);
//     return l.changeNumber > 0;
//   });
// }

// ─── Phase 3.4 — Combined ordered detector with cross-format deduplication ────

/**
 * Canonical key used for cross-format deduplication.
 *
 * For Change-ID matches the key is the normalised hash.
 * For URL and bare-number matches the key is *normally* the change number —
 * but a bare numeric ID and a Change-Id hash can refer to the exact same
 * underlying Gerrit change (they are just two identifier schemes for one
 * change). Without knowledge of that equivalence, a numeric URL match and a
 * Change-Id match pointing at the same target would get different keys
 * (`num:12345` vs `change_id:iabc...`) and survive deduplication as two
 * "different" linkages, even though they resolve to one target commit.
 *
 * When an optional `identityMap` (built once from the whole dataset) is
 * supplied, a numeric match is first resolved to its known Change-Id and
 * keyed as `change_id:<hash>` — the same key a direct Change-Id match to that
 * change would produce — so the two collapse into a single canonical entry.
 * If the number has no known Change-Id in the dataset, it falls back to the
 * plain `num:<n>` key as before.
 *
 * The source field is NOT part of the key so the same target mentioned in
 * multiple fields collapses to a single entry (the highest-confidence one is
 * kept because the three detectors are run in descending confidence order).
 */
function canonicalKey(l: GerritLinkage, identityMap?: ChangeIdentityMap): string {
  if (l.detectionMethod === "change_id" && l.changeId) {
    return `change_id:${l.changeId.toLowerCase()}`;
  }
  if (l.changeNumber > 0) {
    const resolvedId = identityMap?.numToId.get(l.changeNumber);
    if (resolvedId) return `change_id:${resolvedId.toLowerCase()}`;
    return `num:${l.changeNumber}`;
  }
  return `num:${l.changeNumber}`;
}

/**
 * Confidence ordering — lower index = higher confidence.
 * Used to decide which entry to keep when two linkages share the same
 * canonical key.
 */
const CONFIDENCE_ORDER: readonly ConfidenceLevel[] = ["high", "medium", "low"];

function confidenceRank(c: ConfidenceLevel): number {
  return CONFIDENCE_ORDER.indexOf(c);
}

/**
 * Runs all three detectors **in order** for a single text field:
 *   1. URL hyperlinks  — highest confidence, consumed first.
 *   2. Change IDs      — consume their spans before number scanning.
 *   3. Bare numbers    — operate on what is left after the first two passes.
 *
 * Returns deduplicated linkages for this single field.  Callers are expected
 * to merge across fields using `deduplicateAcrossFields`.
 *
 * Self-links are always discarded: a candidate is a self-link when its
 * `changeNumber` equals `ownChangeNumber` (numeric URL / bare-number match),
 * or its `changeId` equals `ownChangeId` (Change-ID match).  The Change-ID
 * detector already drops most hash self-refs; this function adds the numeric
 * guard for URL-embedded change numbers.
 *
 * Cross-identifier self-links: a same-type comparison alone misses the case
 * where the *own* change is identified in the dataset by one identifier type
 * (say, its Change-Id) while the scanned text references it via the other
 * type (say, a numeric review-URL pointing at that very same change). To
 * catch this, callers may optionally supply `changeIdentityMap` — a
 * bidirectional lookup built from the full dataset (numeric change number ⇄
 * Change-Id hash) — so a detected changeNumber can be resolved to a
 * Change-Id (and compared against `ownChangeId`), and a detected changeId
 * can be resolved to a changeNumber (and compared against
 * `ownChangeNumber`), even though the two are expressed as different
 * identifier types for the same underlying change.
 *
 * @param text              Raw source text.
 * @param baseUrl           Base URL of the target Gerrit instance.
 * @param sourceField       Which data field this text came from.
 * @param contextText       Full context message stored on each linkage object.
 * @param ownChangeId       The change's own Change-Id hash (self-refs skipped).
 * @param ownChangeNumber   The change's own numeric ID (self-refs skipped).
 * @param changeIdentityMap Optional bidirectional numeric-ID ⇄ Change-Id
 *                          lookup used to catch cross-identifier self-refs.
 */
export interface ChangeIdentityMap {
  /** numeric change number → Change-Id hash (lower-cased, "i"-prefixed) */
  numToId: Map<number, string>;
  /** Change-Id hash (lower-cased) → numeric change number */
  idToNum: Map<string, number>;
}

export function extractAllLinkages(
  text: string,
  baseUrl: string,
  sourceField: GerritLinkage["sourceFields"][number],
  contextText: string,
  ownChangeId: string | null = null,
  ownChangeNumber: number | null = null,
  changeIdentityMap?: ChangeIdentityMap,
): GerritLinkage[] {
  if (!text) return [];

  const normalizedOwnId = ownChangeId?.toLowerCase() ?? null;

  // Pass 1 — URL detector (also returns masked text).
  const urlResult = extractLinkages(text, baseUrl, sourceField, contextText);

  // Pass 2 — Change-ID detector (operates on URL-masked text).
  const changeIdResult = extractChangeIdLinkages(
    urlResult.maskedText,
    sourceField,
    contextText,
    ownChangeId,
  );

  // Pass 3 — Bare-number detector (operates on doubly-masked text).
  // const numberLinkages = extractNumberLinkages(
  //   changeIdResult.maskedText,
  //   sourceField,
  //   contextText,
  // );

  // Merge all three, preserving order (URL first, then Change-ID, then number).
  const combined: GerritLinkage[] = [
    ...urlResult.linkages,
    ...changeIdResult.linkages,
    // ...numberLinkages,
  ];

  // Intra-field deduplication by canonical key: keep the highest-confidence entry.
  const best = new Map<string, GerritLinkage>();
  for (const l of combined) {
    const key = canonicalKey(l, changeIdentityMap);
    const existing = best.get(key);
    if (
      !existing ||
      confidenceRank(l.confidence) < confidenceRank(existing.confidence)
    ) {
      best.set(key, l);
    }
  }

  // Drop self-links: discard any linkage that resolves back to the change
  // currently being processed, whether identified by numeric ID or Change-ID.
  return [...best.values()].filter((l) => {
    // Same-type comparisons.
    if (
      ownChangeNumber !== null &&
      l.changeNumber > 0 &&
      l.changeNumber === ownChangeNumber
    )
      return false;
    if (
      normalizedOwnId !== null &&
      l.changeId !== null &&
      l.changeId.toLowerCase() === normalizedOwnId
    )
      return false;

    // Cross-type comparisons: the linkage and the "own" change may each be
    // expressed with a different identifier type but still refer to the same
    // underlying change. Only possible when the caller supplied a dataset
    // identity map to bridge numeric IDs and Change-Id hashes.
    if (changeIdentityMap) {
      // Detected numeric changeNumber → resolve to Change-Id, compare to own Change-Id.
      if (
        normalizedOwnId !== null &&
        l.changeNumber > 0
      ) {
        const resolvedId = changeIdentityMap.numToId.get(l.changeNumber);
        if (resolvedId && resolvedId.toLowerCase() === normalizedOwnId) return false;
      }
      // Detected Change-Id → resolve to changeNumber, compare to own changeNumber.
      if (
        ownChangeNumber !== null &&
        l.changeId !== null
      ) {
        const resolvedNum = changeIdentityMap.idToNum.get(l.changeId.toLowerCase());
        if (resolvedNum !== undefined && resolvedNum === ownChangeNumber) return false;
      }
    }

    return true;
  });
}

/**
 * Deduplicates linkages that were merged from multiple source fields.
 *
 * When the same target appears in e.g. both `commit_message` and `change_log`,
 * the entry with the higher confidence is retained AND the `sourceFields`
 * arrays of all duplicates are merged so that every field origin is recorded.
 * If confidence is equal, the first one encountered is used as the base entry
 * (i.e. commit_message > change_log > comments when the caller passes them in
 * that order).
 *
 * Cross-identifier duplicates: two linkages can point at the same underlying
 * Gerrit change while looking "different" purely because one was matched as
 * a Change-Id hash and the other as a bare numeric ID / URL. Passing the same
 * `changeIdentityMap` used elsewhere lets `canonicalKey` resolve both to the
 * same key so they merge into a single entry instead of producing two
 * "distinct" linkages (and, downstream, duplicate detail rows) for one target.
 *
 * @param linkages         Flat list of linkages from all fields.
 * @param changeIdentityMap Optional bidirectional numeric-ID ⇄ Change-Id
 *                          lookup (same one passed to `extractAllLinkages`)
 *                          used to recognise cross-identifier duplicates.
 */
export function deduplicateAcrossFields(
  linkages: GerritLinkage[],
  changeIdentityMap?: ChangeIdentityMap,
): GerritLinkage[] {
  const best = new Map<string, GerritLinkage>();
  for (const l of linkages) {
    const key = canonicalKey(l, changeIdentityMap);
    const existing = best.get(key);
    if (!existing) {
      best.set(key, l);
    } else {
      // Merge sourceFields from both entries (deduplicated).
      const mergedFields = Array.from(
        new Set([...existing.sourceFields, ...l.sourceFields]),
      ) as GerritLinkage["sourceFields"];
      // Keep the higher-confidence entry as the base, updating its sourceFields.
      const base =
        confidenceRank(l.confidence) < confidenceRank(existing.confidence)
          ? l
          : existing;
      best.set(key, { ...base, sourceFields: mergedFields });
    }
  }
  return [...best.values()];
}