/**
 * @file writer.ts
 * @description Writes each enriched change's category data as an individual JSON file inside a directory per change.
 *
 * Output layout:
 *   <outputDir>/
 *     <change_number>/
 *       metadata.json
 *       patchsets.json
 *       diffs.json
 *       comments.json
 *
 * Atomic write strategy:
 *   1. Write to `<filename>.json.tmp`
 *   2. Rename to `<filename>.json`
 * This ensures no partially-written file is ever mistaken for a valid one by
 * the checkpoint scanner on the next resume.
 */

import * as fs from "fs";
import * as path from "path";

// ─── ChangeWriter ─────────────────────────────────────────────────────────────

export class ChangeWriter {
  private readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = path.resolve(outputDir);
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Atomically writes mode-specific data to `<outputDir>/<changeIdNumber>/<filename>.json`.
   */
  write(changeIdNumber: number, filename: string, data: unknown): void {
    const changeDir = path.join(this.outputDir, String(changeIdNumber));
    fs.mkdirSync(changeDir, { recursive: true });

    const finalPath = path.join(changeDir, `${filename}.json`);
    const tmpPath = finalPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
      console.error(
        `[ChangeWriter] Error stringifying data for change ${changeIdNumber} in file ${filename}:`,
        error,
      );

      // Fallback: try to write using a safe stringifier that handles circular references and bigints
      const safeStringify = (obj: any) => {
        const cache = new Set();
        return JSON.stringify(
          obj,
          (key, value) => {
            if (typeof value === "bigint") return value.toString();
            if (typeof value === "object" && value !== null) {
              if (cache.has(value)) return "[Circular]";
              cache.add(value);
            }
            return value;
          },
          2,
        );
      };

      try {
        fs.writeFileSync(tmpPath, safeStringify(data), "utf8");
        console.warn(
          `[ChangeWriter] Successfully used fallback safe-stringify for change ${changeIdNumber}`,
        );
      } catch (safeError) {
        console.error(`[ChangeWriter] Safe stringify also failed:`, safeError);
        throw safeError;
      }
    }
    fs.renameSync(tmpPath, finalPath);
  }

  /**
   * Returns a writer for streaming an array to a file atomically, item by item.
   * Prevents accumulating massive arrays in memory.
   */
  createArrayStream(changeIdNumber: number, filename: string) {
    const changeDir = path.join(this.outputDir, String(changeIdNumber));
    fs.mkdirSync(changeDir, { recursive: true });

    const finalPath = path.join(changeDir, `${filename}.json`);
    const tmpPath = finalPath + ".tmp";
    const fd = fs.openSync(tmpPath, "w");

    fs.writeSync(fd, "[\n");
    let first = true;

    return {
      writeItem: (item: unknown) => {
        if (!first) fs.writeSync(fd, ",\n");
        first = false;
        try {
          const itemJson = JSON.stringify(item, null, 2);
          const indented = itemJson
            .split("\n")
            .map((l) => "  " + l)
            .join("\n");
          fs.writeSync(fd, indented);
        } catch (err) {
          console.error(
            `[ChangeWriter] Failed to stringify array item for change ${changeIdNumber}:`,
            err,
          );
          fs.writeSync(fd, `  { "error": "Failed to stringify item" }`);
        }
      },
      close: () => {
        if (!first) fs.writeSync(fd, "\n");
        fs.writeSync(fd, "]\n");
        fs.closeSync(fd);
        fs.renameSync(tmpPath, finalPath);
      },
      abort: () => {
        fs.closeSync(fd);
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      },
    };
  }
}
