import type { RecipeInput, RecipeRow } from "@/services/products-service";

/**
 * Editing state of one DRAFT recipe (R13 §3) and the pure rules around it:
 * which version to show, how a draft becomes the API body, and what is
 * incomplete before the server is asked. Unit-tested (`recipe-draft.spec.ts`).
 */
export interface RecipeDraftLine {
  /** Stable React key (the server line id, or a client id for a new line). */
  key: string;
  componentProductId: string;
  /** Display only: "SKU · name". */
  label: string;
  /** Decimal text as typed. */
  quantity: string;
  unitId: string;
}

export interface RecipeDraft {
  /** The saved DRAFT's id; null while the draft only exists in the editor (first save creates it). */
  id: string | null;
  outputQuantity: string;
  directCostEstimate: string;
  notes: string;
  lines: RecipeDraftLine[];
}

export type RecipeProductKind = "ASSEMBLED" | "KIT";

export function emptyDraft(): RecipeDraft {
  return { id: null, outputQuantity: "1", directCostEstimate: "", notes: "", lines: [] };
}

export function draftFromRecipe(recipe: RecipeRow): RecipeDraft {
  return {
    id: recipe.id,
    outputQuantity: String(recipe.outputQuantity ?? 1),
    directCostEstimate: recipe.directCostEstimate ?? "",
    notes: recipe.notes ?? "",
    lines: [...recipe.lines]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        key: line.id,
        componentProductId: line.componentProductId,
        label: `${line.componentSku} · ${line.componentName}`,
        quantity: line.quantity,
        unitId: line.unitId,
      })),
  };
}

const positive = (text: string) => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) && value > 0;
};

export type RecipeDraftIssue =
  "NO_LINES" | "LINE_INCOMPLETE" | "DUPLICATE_COMPONENT" | "OUTPUT_INVALID" | "DIRECT_COST_INVALID";

/** What is incomplete in the draft — empty when it can be saved. Mirrors, never replaces, the server's activation checks. */
export function draftIssues(draft: RecipeDraft, kind: RecipeProductKind): RecipeDraftIssue[] {
  const issues: RecipeDraftIssue[] = [];
  if (draft.lines.length === 0) issues.push("NO_LINES");
  if (
    draft.lines.some((line) => !line.componentProductId || !line.unitId || !positive(line.quantity))
  ) {
    issues.push("LINE_INCOMPLETE");
  }
  const components = draft.lines.map((line) => line.componentProductId).filter(Boolean);
  if (new Set(components).size !== components.length) issues.push("DUPLICATE_COMPONENT");
  if (kind === "ASSEMBLED") {
    // An assembled batch yields at least one unit.
    if (!positive(draft.outputQuantity) || Number(draft.outputQuantity) < 1) {
      issues.push("OUTPUT_INVALID");
    }
    const direct = draft.directCostEstimate.trim();
    if (direct !== "" && !(Number.isFinite(Number(direct)) && Number(direct) >= 0)) {
      issues.push("DIRECT_COST_INVALID");
    }
  }
  return issues;
}

/**
 * The create / replace body. A Kit's output is fixed at 1 and it carries no
 * direct-cost estimate; an Assembled item's direct cost is an estimate only.
 */
export function draftToInput(draft: RecipeDraft, kind: RecipeProductKind): RecipeInput {
  const direct = draft.directCostEstimate.trim();
  return {
    outputQuantity: kind === "KIT" ? 1 : Number(draft.outputQuantity),
    ...(kind === "ASSEMBLED" ? { directCostEstimate: direct === "" ? null : Number(direct) } : {}),
    notes: draft.notes.trim() || undefined,
    lines: draft.lines.map((line) => ({
      componentProductId: line.componentProductId,
      quantity: line.quantity.trim(),
      unitId: line.unitId,
    })),
  };
}

export function isDraftDirty(draft: RecipeDraft, saved: RecipeDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

/** The version shown first: the ACTIVE one, else the newest DRAFT, else the newest version. */
export function defaultVersion(recipes: RecipeRow[]): RecipeRow | null {
  if (recipes.length === 0) return null;
  const newestFirst = [...recipes].sort((a, b) => b.version - a.version);
  return (
    newestFirst.find((recipe) => recipe.status === "ACTIVE") ??
    newestFirst.find((recipe) => recipe.status === "DRAFT") ??
    newestFirst[0]
  );
}

/** "New version" copies the active version; with none active, the newest one. */
export function copySource(recipes: RecipeRow[]): RecipeRow | null {
  const newestFirst = [...recipes].sort((a, b) => b.version - a.version);
  return newestFirst.find((recipe) => recipe.status === "ACTIVE") ?? newestFirst[0] ?? null;
}
