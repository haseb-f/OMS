const JOB_KEY_PREFIX = "oms.print-job.";
/** Jobs older than this are treated as expired and cleaned up. */
const JOB_TTL_MS = 5 * 60 * 1000;

type StoredJob = {
  createdAt: number;
  payload: unknown;
};

/**
 * Hands a print payload from the app page to an isolated `/print/*` tab.
 *
 * Uses `localStorage` (not `sessionStorage`) so the print tab can read the
 * job even when the browser opens the tab without an opener relationship
 * (`noopener` / COOP / automation). Jobs are TTL-scoped and removed on read
 * so they do not linger across sessions.
 */
export function createPrintJob(payload: unknown): string {
  const jobId = crypto.randomUUID();
  const stored: StoredJob = { createdAt: Date.now(), payload };
  localStorage.setItem(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(stored));
  pruneExpiredPrintJobs();
  return jobId;
}

export function readPrintJob<T>(jobId: string): T | null {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredJob | unknown;
    // Backward-compat: older jobs stored the payload directly.
    if (parsed && typeof parsed === "object" && "payload" in parsed && "createdAt" in parsed) {
      const job = parsed as StoredJob;
      if (Date.now() - job.createdAt > JOB_TTL_MS) {
        localStorage.removeItem(key);
        return null;
      }
      // Keep the job until TTL expiry so React Strict Mode remounts
      // (and a quick refresh of the print tab) can still read it.
      return job.payload as T;
    }
    return parsed as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function clearPrintJob(jobId: string): void {
  localStorage.removeItem(`${JOB_KEY_PREFIX}${jobId}`);
}

function pruneExpiredPrintJobs(): void {
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(JOB_KEY_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as StoredJob;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.createdAt === "number" &&
        now - parsed.createdAt > JOB_TTL_MS
      ) {
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
}
