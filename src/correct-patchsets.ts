/**
 * @file correct-patchsets.ts
 * @description Script to update existing patchsets.json files in a project
 *              by adding the `commit_message` attribute.
 *
 * It iterates through all change directories in the specified project output directory,
 * loads `patchsets.json`, and fills in any missing/null `commit_message` properties.
 *
 * Optimizations:
 *   - Uses the `commit_message` from `metadata.json` for the latest patchset,
 *     avoiding network requests for changes with only one patchset.
 *   - Fetches other patchsets' commit messages from the Gerrit REST API.
 *   - Runs with bounded concurrency to process changes efficiently.
 *
 * Usage:
 *   npx ts-node src/correct-patchsets.ts --project-dir <path> --gerrit-url <url> [options]
 *
 * Example:
 *   npx ts-node src/correct-patchsets.ts --project-dir ./output/libreoffice_changes --gerrit-url https://gerrit.libreoffice.org/
 */

import * as fs from "fs";
import * as path from "path";
import { GerritClient, withRetry } from "./gerrit-client";

// ─── CLI argument parsing ─────────────────────────────────────────────────────

interface CliArgs {
  projectDir: string;
  gerritUrl: string;
  concurrency: number;
  rateMax: number;
  rateWindowMs: number;
  rateIntervalMs: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);

  let projectDir: string | undefined;
  let gerritUrl: string | undefined;
  let concurrency = 10;
  let rateMax = 30;
  let rateWindowMs = 10_000;
  let rateIntervalMs = 200;
  let timeoutMs = 30_000;

  const requireInt = (value: string | undefined, flag: string): number => {
    const n = parseInt(value ?? "", 10);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(`${flag} must be a positive integer, got: ${value}`);
    return n;
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--project-dir":
        projectDir = args[++i];
        break;
      case "--gerrit-url":
        gerritUrl = args[++i];
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
      default:
        console.warn(`[correct-patchsets] Unknown argument: ${args[i]}`);
    }
  }

  if (!projectDir) {
    throw new Error("Missing required argument: --project-dir <path>");
  }
  if (!gerritUrl) {
    throw new Error("Missing required argument: --gerrit-url <url>");
  }

  return {
    projectDir,
    gerritUrl,
    concurrency,
    rateMax,
    rateWindowMs,
    rateIntervalMs,
    timeoutMs,
  };
}

// ─── Concurrency pool helper ──────────────────────────────────────────────────

async function runWithSlidingWindow<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<void> {
  let nextIndex = 0;
  let inFlight = 0;

  return new Promise((resolve, reject) => {
    const tryLaunch = (): void => {
      while (inFlight < concurrency && nextIndex < tasks.length) {
        const taskFn = tasks[nextIndex++];
        inFlight++;

        taskFn()
          .then(() => {
            inFlight--;
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
      if (inFlight === 0 && nextIndex >= tasks.length) {
        resolve();
      }
    };
    tryLaunch();
  });
}

// ─── Core Correction Logic ────────────────────────────────────────────────────

async function correctChangePatchsets(
  changeDir: string,
  changeNum: number,
  client: GerritClient
): Promise<{ checked: boolean; updated: boolean; apiCalls: number }> {
  const patchsetsPath = path.join(changeDir, "patchsets.json");
  if (!fs.existsSync(patchsetsPath)) {
    return { checked: false, updated: false, apiCalls: 0 };
  }

  let patchsets: any[];
  try {
    patchsets = JSON.parse(fs.readFileSync(patchsetsPath, "utf8"));
  } catch (err) {
    console.error(`[correct] Failed to parse ${patchsetsPath}:`, err);
    return { checked: true, updated: false, apiCalls: 0 };
  }

  if (!Array.isArray(patchsets) || patchsets.length === 0) {
    return { checked: true, updated: false, apiCalls: 0 };
  }

  // Check if any patchset is missing the commit_message property (or if it is null)
  const needsCorrection = patchsets.some(
    (ps) => !("commit_message" in ps) || ps.commit_message === null
  );

  if (!needsCorrection) {
    return { checked: true, updated: false, apiCalls: 0 };
  }

  // Load metadata.json to get the latest commit message if possible
  const metadataPath = path.join(changeDir, "metadata.json");
  let latestCommitMessage: string | null = null;
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      latestCommitMessage = metadata.commit_message ?? null;
    } catch (err) {
      // Ignore metadata read errors
    }
  }

  // Find the maximum patchset_number
  const maxPatchsetNum = Math.max(...patchsets.map((ps) => ps.patchset_number));

  let modified = false;
  let apiCalls = 0;

  for (const ps of patchsets) {
    if (!("commit_message" in ps) || ps.commit_message === null) {
      if (ps.patchset_number === maxPatchsetNum && latestCommitMessage !== null) {
        ps.commit_message = latestCommitMessage;
        modified = true;
      } else {
        // Fetch from Gerrit API
        try {
          apiCalls++;
          const commitInfo = await withRetry(() =>
            client.fetchCommitInfo(changeNum, String(ps.patchset_number))
          );
          ps.commit_message = commitInfo.message ?? null;
          modified = true;
        } catch (err) {
          console.warn(
            `  [correct] Failed to fetch commit info for #${changeNum} PS ${ps.patchset_number}:`,
            (err as Error).message
          );
          ps.commit_message = null;
        }
      }
    }
  }

  if (modified) {
    const tmpPath = patchsetsPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(patchsets, null, 2), "utf8");
    fs.renameSync(tmpPath, patchsetsPath);
  }

  return { checked: true, updated: modified, apiCalls };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const {
    projectDir,
    gerritUrl,
    concurrency,
    rateMax,
    rateWindowMs,
    rateIntervalMs,
    timeoutMs,
  } = parseArgs(process.argv);

  const resolvedDir = path.resolve(projectDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`[correct-patchsets] Directory does not exist: ${resolvedDir}`);
    process.exit(1);
  }

  console.log("═".repeat(60));
  console.log("  Gerrit Patchsets Correction Script");
  console.log("═".repeat(60));
  console.log(`  Project Dir     : ${resolvedDir}`);
  console.log(`  Gerrit URL      : ${gerritUrl}`);
  console.log(`  Concurrency     : ${concurrency}`);
  console.log(`  Rate Limit      : ${rateMax} req / ${rateWindowMs}ms`);
  console.log(`  Min Interval    : ${rateIntervalMs}ms`);
  console.log(`  Request Timeout : ${timeoutMs}ms`);
  console.log("═".repeat(60));

  const client = new GerritClient(gerritUrl, {
    rateLimiter: {
      maxRequests: rateMax,
      windowMs: rateWindowMs,
      minIntervalMs: rateIntervalMs,
      requestTimeoutMs: timeoutMs,
    },
  });

  const entries = fs.readdirSync(resolvedDir);
  const changeDirs = entries.filter(
    (f) =>
      /^\d+$/.test(f) &&
      fs.statSync(path.join(resolvedDir, f)).isDirectory()
  );

  console.log(`Found ${changeDirs.length} change directories to scan.`);

  let totalChecked = 0;
  let totalUpdated = 0;
  let totalApiCalls = 0;
  let completed = 0;

  const tasks = changeDirs.map((dir) => async () => {
    const num = parseInt(dir, 10);
    const changePath = path.join(resolvedDir, dir);
    const { checked, updated, apiCalls } = await correctChangePatchsets(changePath, num, client);
    
    if (checked) totalChecked++;
    if (updated) {
      totalUpdated++;
      console.log(`[${++completed}/${changeDirs.length}] Updated #${num} (made ${apiCalls} API calls)`);
    } else {
      completed++;
    }
    totalApiCalls += apiCalls;
  });

  await runWithSlidingWindow(tasks, concurrency);

  console.log("\n" + "═".repeat(60));
  console.log("  Correction Complete ✓");
  console.log("═".repeat(60));
  console.log(`  Total directories scanned: ${changeDirs.length}`);
  console.log(`  Patchsets checked        : ${totalChecked}`);
  console.log(`  Patchsets updated        : ${totalUpdated}`);
  console.log(`  Total Gerrit API calls   : ${totalApiCalls}`);
  console.log("═".repeat(60) + "\n");
}

main().catch((err: unknown) => {
  console.error("[correct-patchsets] Fatal error:", err);
  process.exit(1);
});
