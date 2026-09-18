/** Drops empty-string optional fields so UUID/date validators do not see `""`. */
export function compactPayload<T extends Record<string, unknown>>(dto: T): T {
  const out = { ...dto };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (value === "" || value === undefined) {
      delete out[key];
    }
  }
  return out;
}
