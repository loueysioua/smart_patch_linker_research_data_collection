/**
 * @file index.ts
 * @description Entry point for the Gerrit data-collection script.
 *
 * Pipeline per change:
 *   1. Query /changes/ with ALL_REVISIONS + DETAILED_ACCOUNTS + MESSAGES
 *   2. For each patchset revision:
 *        a. GET /revisions/{sha}/files      → file list
 *        b. GET /revisions/{sha}/files/{f}/diff → unified diff per file
 *   3. GET /revisions/current/commit        → full commit message
 *   4. GET /comments                        → inline comments
 *   5. Map raw data → ChangeMetadata → write as <_number>.json in output dir
 *
 * Interruption recovery:
 *   On restart the CheckpointManager scans the output directory for existing
 *   `<_number>.json` files, validates each one, and builds two sets:
 *     - cleanIds   → skip (already correctly written)
 *     - corruptIds → re-fetch (file exists but failed integrity validation;
 *                              the bad file is deleted automatically)
 *   No tmp file or streaming state needed — each file is written atomically.
 *
 * Concurrency model:
 *   A true sliding-window pool keeps exactly `concurrency` enrichment tasks
 *   running at all times (not batch-at-a-time), and the GerritClient's built-in
 *   RateLimiter serialises the actual HTTP calls within each task so we never
 *   exceed Gerrit's quota.
 *
 * Usage:
 *   npx ts-node src/index.ts [options]
 *
 * Options:
 *   --query          <string>   Gerrit search expression (default: "is:open")
 *   --limit          <number>   Maximum number of changes to retrieve
 *   --output         <path>     Output directory for per-change JSON files
 *                               (default: ./output/changes)
 *   --concurrency    <n>        Max parallel per-change enrichment tasks (default: 6)
 *   --rate-max       <n>        Max HTTP requests per rate window (default: 30)
 *   --rate-window    <ms>       Rate-limiter rolling window in ms (default: 10000)
 *   --rate-interval  <ms>       Min gap between consecutive requests in ms (default: 200)
 *   --timeout        <ms>       Per-request HTTP timeout in ms (default: 30000)
 *
 * Example:
 *   npx ts-node src/index.ts --query "is:merged" --limit 50 \
 *     --rate-max 20 --rate-window 10000 --rate-interval 300
 */
import * as fs from "fs";
import * as path from "path";
import {
  GerritClient,
  parallelMap,
  withRetry,
  LIST_OPTIONS_MINIMAL,
  LIST_OPTIONS_FULL,
} from "./gerrit-client";
import {
  mapChangeToMetadata,
  mapChangePatchsets,
  mapChangeDiffs,
  mapChangeComments,
} from "./mapper";
import { ChangeWriter } from "./writer";
import { CheckpointManager } from "./checkpoint";
import { extractAllLinkages, deduplicateAcrossFields } from "./link-detector";
import type {
  ChangeMetadata,
  PatchsetInfo,
  PatchsetDiff,
  ChangeComments,
} from "./types";
import type {
  RawCommentsResponse,
  RawCommitInfo,
  RawDiffInfo,
  RawFilesResponse,
} from "./gerrit-client";
import type { ChangeInfo } from "@gerritcodereview/typescript-api/rest-api";

// ─── Configuration ────────────────────────────────────────────────────────────

//const GERRIT_BASE_URL = "https://gerrit.libreoffice.org/" as const;
const GERRIT_BASE_URL = "https://review.opendev.org/" as const;

const DEFAULT_OUTPUT = "./output/changes" as const;
const DEFAULT_QUERY = "is:closed" as const;
const DEFAULT_CONCURRENCY = 6;

// ─── CLI argument parsing ─────────────────────────────────────────────────────

interface CliArgs {
  query: string;
  limit?: number;
  output: string;
  concurrency: number;
  rateMax: number;
  rateWindowMs: number;
  rateIntervalMs: number;
  timeoutMs: number;
  mode:
    | "metadata"
    | "patchsets"
    | "diffs"
    | "comments"
    | "all"
    | "identify-links";
  gerritUrl: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);

  let query: string = DEFAULT_QUERY;
  let limit: number | undefined;
  let output: string = DEFAULT_OUTPUT;
  let concurrency = DEFAULT_CONCURRENCY;
  let rateMax = 30;
  let rateWindowMs = 10_000;
  let rateIntervalMs = 200;
  let timeoutMs = 300000;
  let mode: CliArgs["mode"] = "all";
  let gerritUrl: string = GERRIT_BASE_URL;

  const requireInt = (value: string | undefined, flag: string): number => {
    const n = parseInt(value ?? "", 10);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(`${flag} must be a positive integer, got: ${value}`);
    return n;
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--query":
        query = args[++i] ?? DEFAULT_QUERY;
        break;
      case "--limit":
        limit = requireInt(args[++i], "--limit");
        break;
      case "--output":
        output = args[++i] ?? DEFAULT_OUTPUT;
        break;
      case "--concurrency":
        concurrency = requireInt(args[++i], "--concurrency");
        break;
      case "--rate-max":
        rateMax = requireInt(args[++i], "--rate-max");
        break;
      case "--rate-window":
        rateWindowMs = requireInt(args[++i], "--rate-window");
        break;
      case "--rate-interval":
        rateIntervalMs = requireInt(args[++i], "--rate-interval");
        break;
      case "--timeout":
        timeoutMs = requireInt(args[++i], "--timeout");
        break;
      case "--gerrit-url":
        gerritUrl = args[++i] ?? GERRIT_BASE_URL;
        break;
      case "--mode":
        const m = args[++i];
        if (
          m !== "metadata" &&
          m !== "patchsets" &&
          m !== "diffs" &&
          m !== "comments" &&
          m !== "all" &&
          m !== "identify-links"
        ) {
          throw new Error(
            `--mode must be one of: metadata, patchsets, diffs, comments, all, identify-links. Got: ${m}`,
          );
        }
        mode = m;
        break;
      default:
        console.warn(`[index] Unknown argument: ${args[i]}`);
    }
  }

  return {
    query,
    limit,
    output,
    concurrency,
    rateMax,
    rateWindowMs,
    rateIntervalMs,
    timeoutMs,
    mode,
    gerritUrl,
  };
}

// ─── Sliding-window concurrency pool ─────────────────────────────────────────

/**
 * Runs `tasks` with at most `concurrency` running at any instant (true sliding
 * window — a new task starts as soon as any running one finishes).
 *
 * Unlike the previous batch-at-a-time approach, this keeps all concurrency
 * slots occupied for the entire duration of the run instead of waiting for
 * the slowest task in each batch before launching the next group.
 *
 * `onComplete` is called with each result in completion order (not submission
 * order) so the writer can stream results immediately.
 */
async function runWithSlidingWindow<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onComplete: (result: T) => void,
): Promise<void> {
  let nextIndex = 0;
  let inFlight = 0;

  return new Promise((resolve, reject) => {
    const tryLaunch = (): void => {
      // Launch as many tasks as available slots allow.
      while (inFlight < concurrency && nextIndex < tasks.length) {
        const taskFn = tasks[nextIndex++];
        inFlight++;

        taskFn()
          .then((result) => {
            inFlight--;
            onComplete(result);
            if (nextIndex < tasks.length) {
              tryLaunch();
            } else if (inFlight === 0) {
              resolve();
            }
          })
          .catch((err) => {
            reject(err);
          });
      }

      // All tasks submitted and nothing running → done.
      if (inFlight === 0 && nextIndex >= tasks.length) {
        resolve();
      }
    };

    tryLaunch();
  });
}

// ─── Per-change enrichment ────────────────────────────────────────────────────

async function enrichMetadata(
  client: GerritClient,
  change: ChangeInfo,
): Promise<ChangeMetadata> {
  const changeId = Number(change._number);
  let commitInfo: RawCommitInfo = {};
  try {
    commitInfo = await withRetry(() =>
      client.fetchCommitInfo(changeId, "current"),
    );
  } catch (err) {
    console.warn(`  [enrich] commit fetch failed for #${changeId}:`, err);
  }
  return mapChangeToMetadata(change, commitInfo);
}

async function enrichPatchsets(
  client: GerritClient,
  change: ChangeInfo,
): Promise<PatchsetInfo[]> {
  const changeId = Number(change._number);
  const revisions = change.revisions ?? {};
  const revShas = Object.keys(revisions);

  // Fan out all per-revision file-list fetches in parallel (bounded by the
  // rate limiter inside each fetchFiles call — no extra concurrency cap needed
  // here because the outer sliding window already limits change-level tasks).
  const filesPerRevision = new Map<string, RawFilesResponse>();
  await parallelMap(revShas, revShas.length, async (sha) => {
    let rawFiles: RawFilesResponse = {};
    try {
      rawFiles = await withRetry(() => client.fetchFiles(changeId, sha));
    } catch (err) {
      console.warn(
        `  [enrich] files fetch failed for #${changeId}@${sha.slice(0, 7)}:`,
        err,
      );
    }
    filesPerRevision.set(sha, rawFiles);
  });

  return mapChangePatchsets(change, filesPerRevision);
}

async function enrichDiffs(
  client: GerritClient,
  change: ChangeInfo,
): Promise<PatchsetDiff[]> {
  const changeId = Number(change._number);
  const revisions = change.revisions ?? {};
  const revShas = Object.keys(revisions);
  const filesPerRevision = new Map<string, RawFilesResponse>();
  const diffsPerRevision = new Map<string, Map<string, RawDiffInfo>>();

  // Fetch file lists for all revisions in parallel.
  await parallelMap(revShas, revShas.length, async (sha) => {
    let rawFiles: RawFilesResponse = {};
    try {
      rawFiles = await withRetry(() => client.fetchFiles(changeId, sha));
    } catch (err) {
      console.warn(
        `  [enrich] files fetch failed for #${changeId}@${sha.slice(0, 7)}:`,
        err,
      );
    }
    filesPerRevision.set(sha, rawFiles);
  });

  // For each revision, fetch all file diffs in parallel.
  await parallelMap(revShas, revShas.length, async (sha) => {
    const rawFiles = filesPerRevision.get(sha) ?? {};
    const filePaths = Object.keys(rawFiles).filter((p) => p !== "/COMMIT_MSG");
    const diffMap = new Map<string, RawDiffInfo>();

    await parallelMap(filePaths, filePaths.length, async (filePath) => {
      try {
        const diff = await withRetry(() =>
          client.fetchFileDiff(changeId, sha, filePath),
        );
        diffMap.set(filePath, diff);
      } catch (err) {
        console.warn(
          `  [enrich] diff fetch failed for #${changeId}@${sha.slice(0, 7)} ${filePath}:`,
          (err as Error).message,
        );
      }
    });

    diffsPerRevision.set(sha, diffMap);
  });

  return mapChangeDiffs(change, diffsPerRevision, filesPerRevision);
}

async function enrichComments(
  client: GerritClient,
  change: ChangeInfo,
): Promise<ChangeComments> {
  const changeId = Number(change._number);
  let rawComments: RawCommentsResponse = {};
  try {
    rawComments = await withRetry(() => client.fetchComments(changeId));
  } catch (err) {
    console.warn(`  [enrich] comments fetch failed for #${changeId}:`, err);
  }
  return mapChangeComments(change, rawComments);
}

// ─── Link Identification ──────────────────────────────────────────────────────

/**
 * Collects all text fields from a single change's metadata and comments files
 * and runs the ordered three-pass detector (URL → Change-ID → bare number)
 * per field, then deduplicates across fields using the canonical change key.
 *
 * Processing order within each field (Phase 3.4):
 *   1. Hyperlinks  — greedily consumed first so their embedded numbers are masked.
 *   2. Change IDs  — consumed before number scanning.
 *   3. Bare numbers — scanned on what remains after the first two passes.
 *
 * Cross-field deduplication keeps the highest-confidence entry for each
 * canonical target (change number or Change-ID hash).
 */
function collectRawLinkages(
  metadataPath: string,
  commentsPath: string,
  baseUrl: string,
  changeNum: number,
): import("./types").GerritLinkage[] {
  const perFieldLists: import("./types").GerritLinkage[][] = [];

  // ── metadata ──────────────────────────────────────────────────────────────
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      const ownChangeId: string | null = metadata.change_id ?? null;

      if (metadata.commit_message) {
        perFieldLists.push(
          extractAllLinkages(
            metadata.commit_message,
            baseUrl,
            "commit_message",
            metadata.commit_message,
            ownChangeId,
            changeNum,
          ),
        );
      }

      if (metadata.change_log && Array.isArray(metadata.change_log.entries)) {
        for (const entry of metadata.change_log.entries) {
          if (entry.message) {
            perFieldLists.push(
              extractAllLinkages(
                entry.message,
                baseUrl,
                "change_log",
                entry.message,
                ownChangeId,
                changeNum,
              ),
            );
          }
        }
      }
    } catch (err) {
      console.warn(
        `[identify-links] Failed to read metadata for change #${changeNum}:`,
        err,
      );
    }
  }

  // ── comments ──────────────────────────────────────────────────────────────
  if (fs.existsSync(commentsPath)) {
    try {
      const comments = JSON.parse(fs.readFileSync(commentsPath, "utf8"));
      const ownChangeId: string | null = comments.change_id ?? null;

      if (Array.isArray(comments.change_comments)) {
        for (const comment of comments.change_comments) {
          if (comment.message) {
            perFieldLists.push(
              extractAllLinkages(
                comment.message,
                baseUrl,
                "change_comment",
                comment.message,
                ownChangeId,
                changeNum,
              ),
            );
          }
        }
      }

      if (Array.isArray(comments.inline_comments)) {
        for (const comment of comments.inline_comments) {
          if (comment.message) {
            perFieldLists.push(
              extractAllLinkages(
                comment.message,
                baseUrl,
                "inline_comment",
                comment.message,
                ownChangeId,
                changeNum,
              ),
            );
          }
        }
      }
    } catch (err) {
      console.warn(
        `[identify-links] Failed to read comments for change #${changeNum}:`,
        err,
      );
    }
  }

  // Flatten and deduplicate across fields: highest confidence wins per target.
  return deduplicateAcrossFields(perFieldLists.flat());
}

async function runIdentifyLinks(
  outputDir: string,
  baseUrl: string,
  writer: ChangeWriter,
  client: GerritClient,
): Promise<void> {
  const resolvedOutDir = path.resolve(outputDir);
  if (!fs.existsSync(resolvedOutDir)) {
    console.error(
      `[identify-links] Output directory does not exist: ${resolvedOutDir}`,
    );
    return;
  }

  const entries = fs.readdirSync(resolvedOutDir);
  const changeDirs = entries.filter(
    (f) =>
      /^\d+$/.test(f) &&
      fs.statSync(path.join(resolvedOutDir, f)).isDirectory(),
  );

  console.log(
    `[identify-links] Found ${changeDirs.length} change directory(s) to process.`,
  );

  // Cache API existence checks so we never query the same change number twice
  const validationCache = new Map<number, boolean>();

  let totalLinks = 0;
  const reportData: {
    sourceChange: number;
    targetChange: number;
    changeId: string | null;
    sourceFields: string[];
    raw: string;
    isExternal: boolean;
    detectionMethod: "url" | "number" | "change_id";
    confidence: import("./types").ConfidenceLevel;
    flagForReview: boolean;
  }[] = [];

  for (const dir of changeDirs) {
    const num = parseInt(dir, 10);
    const metadataPath = path.join(resolvedOutDir, dir, "metadata.json");
    const commentsPath = path.join(resolvedOutDir, dir, "comments.json");

    // Phase 3.4: ordered detection (URL → Change-ID → bare number) + cross-field dedup.
    const allCandidates = collectRawLinkages(
      metadataPath,
      commentsPath,
      baseUrl,
      num,
    );

    // Validate bare-number candidates against the Gerrit API.
    const validatedLinkages: import("./types").GerritLinkage[] = [];
    let urlCount = 0;
    let changeIdCount = 0;
    let bareNumCount = 0;

    for (const candidate of allCandidates) {
      if (candidate.detectionMethod === "url") {
        urlCount++;
        validatedLinkages.push(candidate);
      } else if (candidate.detectionMethod === "change_id") {
        changeIdCount++;
        validatedLinkages.push(candidate);
      } else {
        // bare number — validate against the API
        const cn: number = candidate.changeNumber;
        if (!validationCache.has(cn)) {
          const exists = await client.checkChangeExists(cn);
          validationCache.set(cn, exists);
          if (!exists) {
            console.log(
              `[identify-links]   Discarded bare number ${cn} (not a valid Gerrit change).`,
            );
          }
        }
        if (validationCache.get(cn)) {
          bareNumCount++;
          validatedLinkages.push(candidate);
        }
      }
    }

    writer.write(num, "linkages", validatedLinkages);
    console.log(
      `[identify-links] Change #${num}: ${urlCount} URL, ${changeIdCount} Change-ID, ${bareNumCount} bare-number linkage(s)`,
    );
    totalLinks += validatedLinkages.length;

    for (const link of validatedLinkages) {
      reportData.push({
        sourceChange: num,
        targetChange: link.changeNumber,
        changeId: link.changeId,
        sourceFields: link.sourceFields,
        raw: link.raw,
        isExternal: link.isExternal,
        detectionMethod: link.detectionMethod,
        confidence: link.confidence,
        flagForReview: link.flagForReview,
      });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  GERRIT LINKAGE DETECTION REPORT");
  console.log("=".repeat(60));
  if (reportData.length === 0) {
    console.log("  No linkages found.");
  } else {
    for (const item of reportData) {
      const extLabel = item.isExternal ? " [EXTERNAL]" : "";
      const methodLabel =
        item.detectionMethod === "number"
          ? " [bare number]"
          : item.detectionMethod === "change_id"
            ? " [Change-ID]"
            : "";
      const confidenceLabel = ` [${item.confidence.toUpperCase()}]`;
      const reviewLabel = item.flagForReview ? " ⚑ FLAG FOR REVIEW" : "";
      if (item.detectionMethod === "change_id" && item.changeId) {
        console.log(
          `  Change #${item.sourceChange} -> Mentions Change-ID ${item.changeId}${extLabel}${methodLabel}${confidenceLabel}${reviewLabel} (found in: ${item.sourceFields.join(", ")})`,
        );
      } else {
        console.log(
          `  Change #${item.sourceChange} -> Mentions Change #${item.targetChange}${extLabel}${methodLabel}${confidenceLabel}${reviewLabel} (found in: ${item.sourceFields.join(", ")})`,
        );
      }
      console.log(`    Ref: ${item.raw}`);
    }
  }
  console.log(
    `[identify-links] Completed! Identified a total of ${totalLinks} linkage(s) across ${changeDirs.length} change(s).`,
  );
  console.log("=".repeat(60) + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const {
    query,
    limit,
    output,
    concurrency,
    rateMax,
    rateWindowMs,
    rateIntervalMs,
    timeoutMs,
    mode,
    gerritUrl,
  } = parseArgs(process.argv);

  console.log("═".repeat(60));
  console.log("  Gerrit Data Collection");
  console.log("═".repeat(60));
  console.log(`  Source          : ${gerritUrl}`);
  console.log(`  Query           : ${query}`);
  console.log(`  Limit           : ${limit ?? "none (all results)"}`);
  console.log(`  Concurrency     : ${concurrency}`);
  console.log(`  Rate limit      : ${rateMax} req / ${rateWindowMs}ms`);
  console.log(`  Min interval    : ${rateIntervalMs}ms`);
  console.log(`  Request timeout : ${timeoutMs}ms`);
  console.log(`  Output dir      : ${output}`);
  console.log(`  Mode            : ${mode}`);
  console.log("═".repeat(60));

  if (mode === "identify-links") {
    const writer = new ChangeWriter(output);
    const linkClient = new GerritClient(gerritUrl, {
      rateLimiter: {
        maxRequests: rateMax,
        windowMs: rateWindowMs,
        minIntervalMs: rateIntervalMs,
        requestTimeoutMs: timeoutMs,
      },
    });
    await runIdentifyLinks(output, gerritUrl, writer, linkClient);
    return;
  }

  const client = new GerritClient(gerritUrl, {
    rateLimiter: {
      maxRequests: rateMax,
      windowMs: rateWindowMs,
      minIntervalMs: rateIntervalMs,
      requestTimeoutMs: timeoutMs,
    },
  });

  const modesToRun: ("metadata" | "patchsets" | "diffs" | "comments")[] =
    mode === "all"
      ? ["metadata", "patchsets", "diffs", "comments"]
      : [mode as any];

  /**
   * Choose which Gerrit list options to request.
   * - metadata and comments only need DETAILED_ACCOUNTS + MESSAGES.
   *   Skipping ALL_REVISIONS makes each page response 3–10× smaller.
   * - patchsets and diffs need ALL_REVISIONS because they iterate over
   *   change.revisions in the enrichment functions.
   */
  const needsRevisions = modesToRun.some(
    (m) => m === "patchsets" || m === "diffs",
  );
  const listOptions = needsRevisions ? LIST_OPTIONS_FULL : LIST_OPTIONS_MINIMAL;

  const writer = new ChangeWriter(output);

  for (const activeMode of modesToRun) {
    console.log("\n" + "─".repeat(60));
    console.log(`  Processing Mode: ${activeMode.toUpperCase()}`);
    console.log("─".repeat(60));

    // ── Checkpoint: scan output directory for active mode ───────────────────────
    const checkpoint = new CheckpointManager(output, activeMode);
    const { cleanIds, corruptIds } = checkpoint.analyse();

    console.log(
      `[index] [${activeMode}] Already written (skip): ${cleanIds.size}`,
    );
    if (corruptIds.size > 0) {
      console.log(
        `[index] [${activeMode}] Re-fetching corrupt   : ${corruptIds.size} (IDs: ${[...corruptIds].join(", ")})`,
      );
    }

    let enriched = 0;
    let skipped = 0;

    /**
     * Process one page of changes: filter already-done IDs, build tasks,
     * run the sliding-window pool, and write results immediately.
     */
    const processPage = async (page: ChangeInfo[]): Promise<void> => {
      const changesToEnrich = page.filter(
        (c) => !cleanIds.has(Number(c._number)),
      );
      skipped += page.length - changesToEnrich.length;
      if (changesToEnrich.length === 0) return;

      const tasks = changesToEnrich.map((change) => async () => {
        const num = Number(change._number);
        const label = `#${num} – ${String(change.subject).slice(0, 50)}`;
        const tag = corruptIds.has(num) ? " [RE-FETCH]" : "";
        console.log(
          `[index] [${activeMode}] Enriching [${++enriched}]${tag} ${label}`,
        );

        let result: unknown;
        if (activeMode === "metadata") {
          result = await enrichMetadata(client, change);
        } else if (activeMode === "patchsets") {
          result = await enrichPatchsets(client, change);
        } else if (activeMode === "diffs") {
          result = await enrichDiffs(client, change);
        } else {
          result = await enrichComments(client, change);
        }

        return { num, result };
      });

      await runWithSlidingWindow(tasks, concurrency, ({ num, result }) => {
        writer.write(num, activeMode, result);
      });
    };

    // Stream pages from Gerrit; start enriching each page immediately
    // so enrichment overlaps with fetching subsequent pages.
    console.log(`[index] [${activeMode}] Streaming change list from Gerrit…`);
    for await (const page of client.fetchAllChangesStream(
      query,
      limit,
      listOptions,
      cleanIds,
    )) {
      await processPage(page);
    }

    console.log(
      `[index] [${activeMode}] Completed ✓ (enriched: ${enriched}, skipped: ${skipped})`,
    );
  }

  console.log("\n" + "═".repeat(60));
  console.log(`  Gerrit Data Collection Complete ✓`);
  console.log("═".repeat(60));
}

// ─── Entry ────────────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error("[index] Fatal error:", err);
  process.exit(1);
});
