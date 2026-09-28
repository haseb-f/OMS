const JOB_KEY_PREFIX = "oms.print-job.";
/** Jobs older than this are treated as expired and cleaned up. */
export const JOB_TTL_MS = 5 * 60 * 1000;
/** At most this many jobs stay in storage; older ones are dropped on every write. */
export const MAX_STORED_JOBS = 3;

type StoredJob = {
  createdAt: number;
  payload: unknown;
};

/** The print job could not be stored (quota exceeded, storage disabled). */
export class PrintJobStorageError extends Error {
  constructor(cause?: unknown) {
    super("print-job-storage");
    this.name = "PrintJobStorageError";
    this.cause = cause;
  }
}

/**
 * Hands a print payload from the app page to an isolated `/print/*` tab.
 *
 * Uses `localStorage` (not `sessionStorage`) so the print tab can read the
 * job even when the browser opens the tab without an opener relationship
 * (`noopener` / COOP / automation). Before writing, expired jobs are removed
 * and only the newest few are kept, so large report payloads never pile up.
 * If the write still exceeds the quota, every other job is dropped and the
 * write is retried once; a second failure throws `PrintJobStorageError`.
 */
export function createPrintJob(payload: unknown, now: number = Date.now()): string {
  const jobId = crypto.randomUUID();
  const value = JSON.stringify({ createdAt: now, payload } satisfies StoredJob);
  pruneStoredJobs(now, MAX_STORED_JOBS - 1);
  try {
    localStorage.setItem(`${JOB_KEY_PREFIX}${jobId}`, value);
  } catch (firstError) {
    pruneStoredJobs(now, 0);
    try {
      localStorage.setItem(`${JOB_KEY_PREFIX}${jobId}`, value);
    } catch {
      throw new PrintJobStorageError(firstError);
    }
  }
  return jobId;
}

export function readPrintJob<T>(jobId: string, now: number = Date.now()): T | null {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredJob | unknown;
    // Backward-compat: older jobs stored the payload directly.
    if (parsed && typeof parsed === "object" && "payload" in parsed && "createdAt" in parsed) {
      const job = parsed as StoredJob;
      if (now - job.createdAt > JOB_TTL_MS) {
        localStorage.removeItem(key);
        return null;
      }
      // Kept (bounded by TTL and MAX_STORED_JOBS) so React Strict Mode
      // remounts and a quick refresh of the print tab can still read it.
      return job.payload as T;
    }
    return parsed as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function clearPrintJob(jobId: string): void {
  try {
    localStorage.removeItem(`${JOB_KEY_PREFIX}${jobId}`);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/** Removes expired / unreadable jobs, then all but the `keep` newest ones. */
function pruneStoredJobs(now: number, keep: number): void {
  const live: { key: string; createdAt: number }[] = [];
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(JOB_KEY_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    let createdAt: number | null = null;
    try {
      const parsed = raw ? (JSON.parse(raw) as Partial<StoredJob>) : null;
      createdAt = typeof parsed?.createdAt === "number" ? parsed.createdAt : null;
    } catch {
      createdAt = null;
    }
    if (createdAt === null || now - createdAt > JOB_TTL_MS) localStorage.removeItem(key);
    else live.push({ key, createdAt });
  }
  live
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(keep)
    .forEach((job) => localStorage.removeItem(job.key));
}
