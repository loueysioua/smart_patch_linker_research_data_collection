import * as fs from "fs";
import * as path from "path";
import { GerritClient, withRetry, LIST_OPTIONS_FULL } from "./gerrit-client";
import {
  mapChangeToMetadata,
  mapChangePatchsets,
  mapChangeComments,
} from "./mapper";
import type { ChangeInfo } from "@gerritcodereview/typescript-api/rest-api";
import type { RawCommitInfo, RawFilesResponse } from "./gerrit-client";

async function enrichMetadata(
  client: GerritClient,
  change: ChangeInfo,
): Promise<any> {
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
): Promise<any> {
  const changeId = Number(change._number);
  const revisions = change.revisions ?? {};
  const revShas = Object.keys(revisions);

  const filesPerRevision = new Map<string, RawFilesResponse>();
  for (const sha of revShas) {
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
  }

  return mapChangePatchsets(change, filesPerRevision);
}

async function enrichComments(
  client: GerritClient,
  change: ChangeInfo,
): Promise<any> {
  const changeId = Number(change._number);
  let rawComments = {};
  try {
    rawComments = await withRetry(() => client.fetchComments(changeId));
  } catch (err) {
    console.warn(`  [enrich] comments fetch failed for #${changeId}:`, err);
  }
  return mapChangeComments(change, rawComments);
}

// Map project folders to Gerrit URLs
const PROJECT_URLS: Record<string, string> = {
  libreoffice_changes: "https://gerrit.libreoffice.org/",
  onap_changes: "https://gerrit.onap.org/r/",
  openstack_changes: "https://review.opendev.org/",
  wikimedia_changes: "https://gerrit.wikimedia.org/r/",
};

async function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error(
      "Usage: npx ts-node fill-missing.ts <path/to/project_changes_dir>",
    );
    process.exit(1);
  }

  const absTargetDir = path.resolve(targetDir);
  const projectName = path.basename(absTargetDir);
  const gerritUrl = PROJECT_URLS[projectName];

  if (!gerritUrl) {
    console.error(
      `Unknown project name ${projectName}, please add it to PROJECT_URLS in this script.`,
    );
    process.exit(1);
  }

  console.log(`Checking ${absTargetDir} (Gerrit: ${gerritUrl})`);

  const client = new GerritClient(gerritUrl, {
    rateLimiter: {
      maxRequests: 30,
      windowMs: 10000,
      minIntervalMs: 200,
      requestTimeoutMs: 30000,
    },
  });

  const changeDirs = fs
    .readdirSync(absTargetDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((name) => /^\d+$/.test(name)); // Only numeric folders

  console.log(`Found ${changeDirs.length} change directories.`);

  for (const changeIdStr of changeDirs) {
    const changeId = parseInt(changeIdStr, 10);
    const dirPath = path.join(absTargetDir, changeIdStr);

    const missingMetadata = !fs.existsSync(path.join(dirPath, "metadata.json"));
    const missingPatchsets = !fs.existsSync(
      path.join(dirPath, "patchsets.json"),
    );
    const missingComments = !fs.existsSync(path.join(dirPath, "comments.json"));

    if (missingMetadata || missingPatchsets || missingComments) {
      console.log(
        `Change ${changeIdStr} is missing files: metadata=${missingMetadata} patchsets=${missingPatchsets} comments=${missingComments}`,
      );

      // Fetch the ChangeInfo
      let changeInfo: ChangeInfo;
      try {
        // We can get the change by using fetchAllChanges with query q=change:${changeId}
        const pages = client.fetchAllChangesStream(
          `change:${changeId}`,
          1,
          LIST_OPTIONS_FULL,
        );
        let found = false;
        for await (const page of pages) {
          if (page.length > 0) {
            changeInfo = page[0] as unknown as ChangeInfo;
            found = true;
            break;
          }
        }
        if (!found) {
          console.warn(
            `Could not fetch ChangeInfo for ${changeId}, deleting directory.`,
          );
          fs.rmSync(dirPath, { recursive: true, force: true });
          continue;
        }
      } catch (err) {
        console.error(
          `Failed to fetch ChangeInfo for ${changeId}, deleting directory. Error:`,
          err,
        );
        fs.rmSync(dirPath, { recursive: true, force: true });
        continue;
      }

      if (missingMetadata) {
        const data = await enrichMetadata(client, changeInfo!);
        fs.writeFileSync(
          path.join(dirPath, "metadata.json"),
          JSON.stringify(data, null, 2),
        );
        console.log(`  -> Wrote metadata.json`);
      }

      if (missingPatchsets) {
        const data = await enrichPatchsets(client, changeInfo!);
        fs.writeFileSync(
          path.join(dirPath, "patchsets.json"),
          JSON.stringify(data, null, 2),
        );
        console.log(`  -> Wrote patchsets.json`);
      }

      if (missingComments) {
        const data = await enrichComments(client, changeInfo!);
        fs.writeFileSync(
          path.join(dirPath, "comments.json"),
          JSON.stringify(data, null, 2),
        );
        console.log(`  -> Wrote comments.json`);
      }
    }
  }

  console.log("Done checking and filling missing data.");
}

main().catch(console.error);
