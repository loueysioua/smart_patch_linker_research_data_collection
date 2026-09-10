/**
 * @file gerrit-client.ts
 * @description HTTP client for the Gerrit REST API.
 *
 * Handles:
 *  - Stripping the magic ")]}'" XSSI protection prefix from every response.
 *  - Paginating through all changes using the _more_changes flag + `S` param.
 *  - Per-change supplementary calls:
 *      - GET /changes/{id}/revisions/{rev}/commit   → full commit message
 *      - GET /changes/{id}/revisions/{rev}/files    → file list per patchset
 *      - GET /changes/{id}/revisions/{rev}/files/{file}/diff → unified diff
 *      - GET /changes/{id}/comments                 → inline comments
 *  - Token-bucket rate limiting so we never exceed Gerrit's request quota.
 *  - Per-request AbortController timeout.
 *  - Exponential-backoff retry on transient failures.
 *
 * Gerrit REST API reference:
 * https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html
 */

import fetch from "node-fetch";
import type {
  AccountInfo,
  ChangeInfo,
} from "@gerritcodereview/typescript-api/rest-api";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Gerrit prefixes every JSON response with this string to prevent XSSI attacks.
 * https://gerrit-review.googlesource.com/Documentation/rest-api.html#output
 */
const GERRIT_XSSI_PREFIX = ")]}'\n" as const;

/** Maximum page size for the /changes/ list endpoint. */
const PAGE_SIZE = 100 as const;

/**
 * Minimal option set for modes that only need basic change fields
 * (metadata, comments). Omitting ALL_REVISIONS shrinks page payloads
 * dramatically — the server doesn't have to serialize every patchset.
 */
export const LIST_OPTIONS_MINIMAL: readonly string[] = [
  "DETAILED_ACCOUNTS",
  "MESSAGES",
] as const;

/**
 * Full option set — used when the caller needs revision data
 * (patchsets / diffs modes).
 */
export const LIST_OPTIONS_FULL: readonly string[] = [
  "DETAILED_ACCOUNTS",
  "ALL_REVISIONS",
  "MESSAGES",
] as const;

// ─── Rate limiter ─────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /**
   * Maximum number of requests allowed per `windowMs`.
   * @default 30
   */
  maxRequests: number;
  /**
   * Rolling window duration in milliseconds.
   * @default 10_000   (10 seconds)
   */
  windowMs: number;
  /**
   * Hard minimum gap between any two consecutive requests in milliseconds.
   * Prevents burst-firing even when the token bucket has capacity.
   * @default 200
   */
  minIntervalMs: number;
  /**
   * Timeout applied to each individual HTTP request in milliseconds.
   * The fetch is aborted and an error thrown if the server does not respond
   * within this window.
   * @default 30_000   (30 seconds)
   */
  requestTimeoutMs: number;
}

const DEFAULT_RATE_LIMITER_OPTIONS: RateLimiterOptions = {
  maxRequests: 30,
  windowMs: 10_000,
  minIntervalMs: 200,
  requestTimeoutMs: 30_000,
};

/**
 * Token-bucket rate limiter with a minimum inter-request interval.
 *
 * Callers `await limiter.acquire()` before every request. The method resolves
 * only when both conditions are satisfied:
 *  1. The rolling window contains fewer than `maxRequests` in-flight timestamps.
 *  2. At least `minIntervalMs` has elapsed since the previous request.
 */
export class RateLimiter {
  private readonly opts: RateLimiterOptions;
  /** Timestamps (Date.now()) of requests dispatched within the current window. */
  private requestTimestamps: number[] = [];
  /** Timestamp of the most recent request dispatched. */
  private lastRequestAt = 0;

  constructor(opts: Partial<RateLimiterOptions> = {}) {
    this.opts = { ...DEFAULT_RATE_LIMITER_OPTIONS, ...opts };
  }

  /**
   * Waits until a request slot is available, then records the dispatch time.
   * Returns the number of milliseconds it waited (useful for debug logging).
   */
  async acquire(): Promise<number> {
    const start = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now();
      const windowStart = now - this.opts.windowMs;

      // Drop timestamps that have left the rolling window.
      this.requestTimestamps = this.requestTimestamps.filter(
        (t) => t > windowStart,
      );

      const windowFull = this.requestTimestamps.length >= this.opts.maxRequests;
      const tooSoon = now - this.lastRequestAt < this.opts.minIntervalMs;

      if (!windowFull && !tooSoon) break;

      // Calculate how long to sleep before the next check.
      let sleepMs = this.opts.minIntervalMs;

      if (windowFull) {
        // Sleep until the oldest request in the window expires.
        const oldestInWindow = this.requestTimestamps[0];
        const windowExpires = oldestInWindow + this.opts.windowMs;
        sleepMs = Math.max(sleepMs, windowExpires - now + 1);
      }

      if (tooSoon) {
        const intervalExpires = this.lastRequestAt + this.opts.minIntervalMs;
        sleepMs = Math.max(sleepMs, intervalExpires - now + 1);
      }

      await sleep(sleepMs);
    }

    const waited = Date.now() - start;
    this.lastRequestAt = Date.now();
    this.requestTimestamps.push(this.lastRequestAt);
    return waited;
  }

  get requestTimeoutMs(): number {
    return this.opts.requestTimeoutMs;
  }
}

// ─── Raw API response shapes ──────────────────────────────────────────────────

/**
 * ChangeInfo extended with the pagination flag returned on the last item.
 */
type RawChangeListItem = ChangeInfo & {
  readonly _more_changes?: true;
};

/**
 * Minimal shape of the CommitInfo returned by
 * GET /changes/{id}/revisions/{rev}/commit
 */
export interface RawCommitInfo {
  readonly message?: string;
  readonly subject?: string;
}

/**
 * Minimal shape of a single entry in
 * GET /changes/{id}/revisions/{rev}/files
 * Key is the file path; value is FileInfo.
 */
export interface RawFileInfo {
  readonly status?: string; // 'A' | 'D' | 'R' | 'C' | 'W'
  readonly binary?: boolean;
  readonly old_path?: string;
  readonly lines_inserted?: number;
  readonly lines_deleted?: number;
}

export type RawFilesResponse = Record<string, RawFileInfo>;

/**
 * Minimal shape of a DiffContent chunk returned by
 * GET /changes/{id}/revisions/{rev}/files/{file}/diff
 */
export interface RawDiffContent {
  readonly a?: string[]; // lines from the old file
  readonly b?: string[]; // lines from the new file
}

export interface RawDiffInfo {
  readonly binary?: boolean;
  readonly content: RawDiffContent[];
}

/**
 * Minimal shape of a CommentInfo entry returned by
 * GET /changes/{id}/comments
 * The response is a map of file-path → CommentInfo[].
 */
export interface RawCommentInfo {
  readonly id: string;
  readonly patch_set?: number;
  readonly line?: number;
  readonly message?: string;
  readonly author?: AccountInfo;
  readonly updated: string;
  readonly in_reply_to?: string;
  readonly unresolved?: boolean;
  readonly tag?: string;
}

export type RawCommentsResponse = Record<string, RawCommentInfo[]>;

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Removes the Gerrit XSSI prefix and parses the body as JSON.
 */
function parseGerritJson<T>(raw: string): T {
  if (!raw.startsWith(GERRIT_XSSI_PREFIX)) {
    throw new Error(
      `Unexpected Gerrit response – missing XSSI prefix.\n` +
        `First 120 chars: ${raw.slice(0, 120)}`,
    );
  }
  return JSON.parse(raw.slice(GERRIT_XSSI_PREFIX.length)) as T;
}

/**
 * URL-encodes a file path for use in Gerrit REST endpoints.
 * Gerrit uses the same percent-encoding as standard URIs, but slashes inside
 * a path component must also be encoded (they are path separators otherwise).
 */
function encodeFilePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("%2F");
}

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries `fn` up to `maxAttempts` times with exponential back-off.
 * Only retries on timeout / network errors; propagates 4xx/5xx immediately.
 *
 * @param fn           Async function to call.
 * @param maxAttempts  Total attempts (1 = no retry).
 * @param baseDelayMs  Initial back-off delay in ms (doubles each attempt).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1_000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Don't retry hard HTTP errors (4xx / 5xx), except for transient ones (502, 503, 504, 429).
      if (
        msg.includes("Gerrit API error:") &&
        !msg.match(/429|502|503|504/)
      ) {
        throw err;
      }
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        console.warn(
          `[GerritClient] Attempt ${attempt}/${maxAttempts} failed (${msg.slice(0, 80)}). Retrying in ${delay}ms…`,
        );
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

/**
 * Runs `items` through `fn` with at most `concurrency` tasks in-flight.
 * Unlike `Promise.all`, this starts a new task as soon as any slot opens.
 *
 * This is intentionally NOT rate-limited here — the GerritClient's internal
 * RateLimiter handles that.  parallelMap just controls task fan-out so we
 * don't queue thousands of promises at once.
 */
export async function parallelMap<A, B>(
  items: A[],
  concurrency: number,
  fn: (item: A) => Promise<B>,
): Promise<B[]> {
  const results: B[] = new Array(items.length);
  let nextIndex = 0;
  let inFlight = 0;

  return new Promise((resolve, reject) => {
    const tryLaunch = (): void => {
      while (inFlight < concurrency && nextIndex < items.length) {
        const idx = nextIndex++;
        inFlight++;
        fn(items[idx])
          .then((val) => {
            results[idx] = val;
            inFlight--;
            if (nextIndex < items.length) {
              tryLaunch();
            } else if (inFlight === 0) {
              resolve(results);
            }
          })
          .catch(reject);
      }
      if (inFlight === 0 && nextIndex >= items.length) resolve(results);
    };
    tryLaunch();
  });
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface GerritClientOptions {
  /** Rate-limiter configuration (merged with defaults). */
  rateLimiter?: Partial<RateLimiterOptions>;
}

export class GerritClient {
  private readonly baseUrl: string;
  private readonly limiter: RateLimiter;

  /**
   * @param baseUrl  Root URL of the Gerrit instance, e.g. "https://gerrit.onap.org/r".
   *                 Trailing slash is normalised away.
   * @param options  Optional rate-limiter overrides and timeout settings.
   */
  constructor(baseUrl: string, options: GerritClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.limiter = new RateLimiter(options.rateLimiter ?? {});
  }

  // ─── Low-level fetch ───────────────────────────────────────────────────────

  /**
   * Performs a rate-limited GET request with a per-request timeout and returns
   * the parsed, XSSI-stripped JSON body.
   *
   * Flow per call:
   *  1. Await a rate-limiter slot (may sleep until capacity is available).
   *  2. Create an AbortController wired to `requestTimeoutMs`.
   *  3. Dispatch the fetch; abort if the server is too slow.
   *  4. Strip the XSSI prefix and parse the body.
   */
  private async getJson<T>(url: URL | string): Promise<T> {
    const href = url instanceof URL ? url.toString() : url;

    // ── Rate limiting ──────────────────────────────────────────────────────
    const waited = await this.limiter.acquire();
    if (waited > 50) {
      console.debug(
        `[GerritClient] Rate-limited: waited ${waited}ms before ${href.slice(href.lastIndexOf("/changes/"))}`,
      );
    }

    // ── Timeout via AbortController ────────────────────────────────────────
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.limiter.requestTimeoutMs,
    );

    let response;
    try {
      response = await fetch(href, {
        headers: { Accept: "application/json" },
        signal: controller.signal as AbortSignal,
      });
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      throw new Error(
        isAbort
          ? `Gerrit request timed out after ${this.limiter.requestTimeoutMs}ms\nURL: ${href}`
          : `Gerrit fetch error: ${String(err)}\nURL: ${href}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(
        `Gerrit API error: ${response.status} ${response.statusText}\nURL: ${href}`,
      );
    }

    const text = await response.text();
    return parseGerritJson<T>(text);
  }

  // ─── Change list ──────────────────────────────────────────────────────────

  /**
   * Fetches ONE page of changes and returns it along with the raw list.
   * Internal helper used by both fetchAllChanges and fetchAllChangesStream.
   */
  private async fetchChangesPage(
    query: string,
    start: number,
    pageSize: number,
    options: readonly string[],
  ): Promise<RawChangeListItem[]> {
    const url = new URL(`${this.baseUrl}/changes/`);
    url.searchParams.set("q", query);
    url.searchParams.set("n", String(pageSize));
    url.searchParams.set("S", String(start));
    for (const opt of options) {
      url.searchParams.append("o", opt);
    }
    return withRetry(() => this.getJson<RawChangeListItem[]>(url));
  }

  /**
   * Async generator that yields each page of changes as it arrives.
   * Enrichment can begin processing the first page while subsequent pages
   * are still being fetched — no need to wait for the full list.
   *
   * @param query    Gerrit search expression.
   * @param limit    Optional hard cap on total changes yielded.
   * @param options  Which o= query options to include (controls payload size).
   */
  async *fetchAllChangesStream(
    query: string = "is:open",
    limit?: number,
    options: readonly string[] = LIST_OPTIONS_FULL,
    resumeIds?: Set<number>,
  ): AsyncGenerator<ChangeInfo[]> {
    let start = 0;
    let fetched = 0;
    let hasFastForwarded = false;

    console.log(`[GerritClient] Streaming changes: query="${query}"`);

    while (true) {
      const pageSize = limit
        ? Math.min(PAGE_SIZE, limit - fetched)
        : PAGE_SIZE;

      if (pageSize <= 0) break;

      console.log(`[GerritClient] → page start=${start}, n=${pageSize}`);
      const page = await this.fetchChangesPage(query, start, pageSize, options);

      if (!Array.isArray(page) || page.length === 0) break;

      fetched += page.length;
      console.log(
        `[GerritClient] ← ${page.length} items (total so far: ${fetched})`,
      );

      yield page;

      if (limit !== undefined && fetched >= limit) {
        console.log(`[GerritClient] Limit of ${limit} reached.`);
        break;
      }

      if (!page[page.length - 1]._more_changes) {
        console.log(`[GerritClient] No more pages.`);
        break;
      }

      start += page.length;

      // ── Fast-forward optimization ──────────────────────────────────────────
      // If the current page was 100% already fetched, we assume we are inside
      // a large contiguous block of cached results. We probe forward to find
      // the end of this block logarithmically to skip thousands of redundant API calls.
      if (resumeIds && !hasFastForwarded && resumeIds.size > 0 && limit === undefined) {
        const allClean = page.every((c) => resumeIds.has(Number(c._number)));
        if (allClean) {
          console.log(
            `[GerritClient] Page at offset ${start - page.length} is fully cached. Fast-forwarding...`,
          );
          let step = PAGE_SIZE;
          let lastClean = start - page.length;
          let firstDirty: number | null = null;
          let probeStart = start;

          // 1. Exponential search forward
          while (true) {
            const probePage = await this.fetchChangesPage(query, probeStart, PAGE_SIZE, options);
            if (!probePage || probePage.length === 0) {
              firstDirty = probeStart;
              break;
            }
            const probeClean = probePage.every((c) => resumeIds.has(Number(c._number)));
            if (probeClean) {
              lastClean = probeStart;
              if (!probePage[probePage.length - 1]._more_changes) {
                firstDirty = probeStart + probePage.length;
                break;
              }
              step *= 2;
              probeStart += step;
            } else {
              firstDirty = probeStart;
              break;
            }
          }

          // 2. Binary search between lastClean and firstDirty
          let low = lastClean;
          let high = firstDirty;
          while (high - low > PAGE_SIZE) {
            const midPages = Math.floor((high - low) / (2 * PAGE_SIZE));
            if (midPages === 0) break;
            const mid = low + midPages * PAGE_SIZE;

            const probePage = await this.fetchChangesPage(query, mid, PAGE_SIZE, options);
            if (!probePage || probePage.length === 0) {
              high = mid;
            } else {
              const probeClean = probePage.every((c) => resumeIds.has(Number(c._number)));
              if (probeClean) {
                low = mid;
              } else {
                high = mid;
              }
            }
          }

          start = low + PAGE_SIZE;
          hasFastForwarded = true;
          console.log(`[GerritClient] Fast-forward complete. Resuming at offset ${start}.`);
        }
      }
    }
  }

  /**
   * Convenience wrapper — collects all pages into a single array.
   * Prefer fetchAllChangesStream when you can start processing early.
   *
   * @param query    Gerrit search expression (default: "is:open").
   * @param limit    Optional hard cap on the total number of changes returned.
   * @param options  Which o= query options to include.
   */
  async fetchAllChanges(
    query: string = "is:open",
    limit?: number,
    options: readonly string[] = LIST_OPTIONS_FULL,
    resumeIds?: Set<number>,
  ): Promise<ChangeInfo[]> {
    const accumulated: ChangeInfo[] = [];
    for await (const page of this.fetchAllChangesStream(query, limit, options, resumeIds)) {
      accumulated.push(...page);
    }
    return accumulated;
  }

  // ─── Commit info ──────────────────────────────────────────────────────────

  /**
   * Returns the full CommitInfo for a specific patchset.
   *
   * GET /changes/{change-id}/revisions/{revision-id}/commit
   *
   * @param changeId   The numeric change ID (_number).
   * @param revisionId Commit SHA or "current".
   */
  async fetchCommitInfo(
    changeId: number,
    revisionId: string,
  ): Promise<RawCommitInfo> {
    const url = new URL(
      `${this.baseUrl}/changes/${changeId}/revisions/${revisionId}/commit`,
    );
    return this.getJson<RawCommitInfo>(url);
  }

  // ─── File list ────────────────────────────────────────────────────────────

  /**
   * Returns the map of files modified in a specific patchset.
   *
   * GET /changes/{change-id}/revisions/{revision-id}/files
   *
   * @param changeId   The numeric change ID (_number).
   * @param revisionId Commit SHA or "current".
   */
  async fetchFiles(
    changeId: number,
    revisionId: string,
  ): Promise<RawFilesResponse> {
    const url = new URL(
      `${this.baseUrl}/changes/${changeId}/revisions/${revisionId}/files`,
    );
    return this.getJson<RawFilesResponse>(url);
  }

  // ─── File diff ────────────────────────────────────────────────────────────

  /**
   * Returns the unified diff of a single file in a patchset.
   *
   * GET /changes/{change-id}/revisions/{revision-id}/files/{file-id}/diff
   *
   * @param changeId   The numeric change ID (_number).
   * @param revisionId Commit SHA or "current".
   * @param filePath   The file path as returned by fetchFiles().
   */
  async fetchFileDiff(
    changeId: number,
    revisionId: string,
    filePath: string,
  ): Promise<RawDiffInfo> {
    const encodedPath = encodeFilePath(filePath);
    const url = new URL(
      `${this.baseUrl}/changes/${changeId}/revisions/${revisionId}/files/${encodedPath}/diff`,
    );
    // intraline=false keeps the response small; we only need the hunk lines.
    url.searchParams.set("intraline", "false");
    return this.getJson<RawDiffInfo>(url);
  }

  // ─── Inline comments ──────────────────────────────────────────────────────

  /**
   * Returns all published inline comments on a change, keyed by file path.
   *
   * GET /changes/{change-id}/comments
   *
   * @param changeId The numeric change ID (_number).
   */
  async fetchComments(changeId: number): Promise<RawCommentsResponse> {
    const url = new URL(`${this.baseUrl}/changes/${changeId}/comments`);
    return this.getJson<RawCommentsResponse>(url);
  }

  /**
   * Checks if a change exists and is valid.
   * GET /changes/{change-id}
   */
  async checkChangeExists(changeId: number): Promise<boolean> {
    try {
      const url = new URL(`${this.baseUrl}/changes/${changeId}`);
      await this.getJson<any>(url);
      return true;
    } catch {
      return false;
    }
  }
}
