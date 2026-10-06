/**
 * R13 — Inventory integrity report (spec §8, api-contract §5). Read-only: every
 * invariant is computed from the stored rows (movements, assembly orders,
 * invoice snapshots, posted journal lines) and nothing is ever corrected here.
 */
export type IntegrityStatus = 'PASS' | 'WARN' | 'FAIL';

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7';

/** One finding. `rule` is a stable code; every other field is plain JSON (strings / numbers / null). */
export interface IntegrityViolation {
  rule: string;
  severity: Exclude<IntegrityStatus, 'PASS'>;
  message: string;
  [detail: string]: unknown;
}

export interface InvariantResult {
  id: InvariantId;
  title: string;
  status: IntegrityStatus;
  /** How many rows / groups the invariant examined. */
  checked: number;
  /** Total number of findings (the list below is capped). */
  violationCount: number;
  violations: IntegrityViolation[];
  truncated: boolean;
  /** Plain-language scope notes (e.g. "company-wide — filters do not apply"). */
  notes: string[];
  /** Named figures (decimal strings / integers) shown next to the invariant. */
  metrics: Record<string, string | number | null>;
}

export interface IntegrityFilter {
  productIds?: string[];
  warehouseId?: string;
}

export interface IntegrityReport {
  generatedAt: string;
  durationMs: number;
  filter: { productIds: string[] | null; warehouseId: string | null };
  status: IntegrityStatus;
  summary: Record<IntegrityStatus, number>;
  invariants: InvariantResult[];
}

/** Per-invariant violation list cap (the total is always reported). */
export const VIOLATION_CAP = 50;
