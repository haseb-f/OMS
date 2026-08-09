/**
 * The one Template Engine every document number renders through
 * (TASK-025 Part 6) — a business changes its numbering format by editing a
 * `NumberSeries.template` string in Settings, never by touching code. New
 * placeholders are added here once and every series can use them
 * immediately, no per-module changes required.
 */
export interface RenderNumberContext {
  docCode: string;
  seq: number;
  padding: number;
  /** Defaults to now — pass explicitly only for deterministic tests. */
  date?: Date;
  branchCode?: string;
  warehouseCode?: string;
  companyCode?: string;
  /** Defaults to the date's calendar year — no distinct fiscal-year calendar exists yet. */
  fiscalYear?: number;
}

export function renderNumberTemplate(
  template: string,
  ctx: RenderNumberContext,
): string {
  const date = ctx.date ?? new Date();
  const replacements: Record<string, string> = {
    '{DOC}': ctx.docCode,
    '{YEAR}': String(date.getFullYear()),
    '{MONTH}': String(date.getMonth() + 1).padStart(2, '0'),
    '{DAY}': String(date.getDate()).padStart(2, '0'),
    '{SEQ}': String(ctx.seq).padStart(ctx.padding, '0'),
    '{BRANCH}': ctx.branchCode ?? '',
    '{WAREHOUSE}': ctx.warehouseCode ?? '',
    '{COMPANY}': ctx.companyCode ?? '',
    '{FISCAL_YEAR}': String(ctx.fiscalYear ?? date.getFullYear()),
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.split(placeholder).join(value);
  }

  // An unset {BRANCH}/{WAREHOUSE}/{COMPANY} resolves to "" — collapse the
  // doubled separators that leaves behind and trim stray leading/trailing
  // ones, so "{BRANCH}-{DOC}-{YEAR}" without a branch renders "SO-2026",
  // not "-SO-2026".
  result = result
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-/]+|[-/]+$/g, '');

  return result;
}

/** The placeholders every series' template may use — drives the Settings UI's helper buttons. */
export const NUMBER_TEMPLATE_PLACEHOLDERS = [
  '{DOC}',
  '{YEAR}',
  '{MONTH}',
  '{DAY}',
  '{SEQ}',
  '{BRANCH}',
  '{WAREHOUSE}',
  '{COMPANY}',
  '{FISCAL_YEAR}',
] as const;
