const JOB_KEY_PREFIX = "oms.print-job.";

/**
 * Hands a print payload from the app page to an isolated `/print/*` tab.
 * `sessionStorage` is used (not a module-level variable) because
 * `window.open` creates a separate JS realm that can't see in-memory
 * state — but per the HTML spec a same-origin tab opened via `window.open`
 * DOES inherit a copy of the opener's `sessionStorage`, so this is the one
 * reliable same-origin channel that needs no server round-trip.
 */
export function createPrintJob(payload: unknown): string {
  const jobId = crypto.randomUUID();
  sessionStorage.setItem(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(payload));
  return jobId;
}

export function readPrintJob<T>(jobId: string): T | null {
  const raw = sessionStorage.getItem(`${JOB_KEY_PREFIX}${jobId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearPrintJob(jobId: string): void {
  sessionStorage.removeItem(`${JOB_KEY_PREFIX}${jobId}`);
}
