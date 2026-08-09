/**
 * Client-side mirror of `apps/api/src/numbering/template-renderer.ts` — used
 * only for the Settings > Document Numbering live preview (instant feedback
 * while an admin edits a template, no round trip). The API's renderer is
 * still the one and only source of truth for numbers actually issued to
 * documents; if the two ever need to diverge, they must change together.
 */
export interface RenderNumberPreviewContext {
  docCode: string;
  seq: number;
  padding: number;
  date?: Date;
  branchCode?: string;
  warehouseCode?: string;
  companyCode?: string;
}

export function renderNumberTemplatePreview(
  template: string,
  ctx: RenderNumberPreviewContext,
): string {
  const date = ctx.date ?? new Date();
  const replacements: Record<string, string> = {
    "{DOC}": ctx.docCode,
    "{YEAR}": String(date.getFullYear()),
    "{MONTH}": String(date.getMonth() + 1).padStart(2, "0"),
    "{DAY}": String(date.getDate()).padStart(2, "0"),
    "{SEQ}": String(ctx.seq).padStart(ctx.padding, "0"),
    "{BRANCH}": ctx.branchCode ?? "",
    "{WAREHOUSE}": ctx.warehouseCode ?? "",
    "{COMPANY}": ctx.companyCode ?? "",
    "{FISCAL_YEAR}": String(date.getFullYear()),
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.split(placeholder).join(value);
  }

  result = result
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "");

  return result;
}

export const NUMBER_TEMPLATE_PLACEHOLDERS = [
  "{DOC}",
  "{YEAR}",
  "{MONTH}",
  "{DAY}",
  "{SEQ}",
  "{BRANCH}",
  "{WAREHOUSE}",
  "{COMPANY}",
  "{FISCAL_YEAR}",
] as const;
