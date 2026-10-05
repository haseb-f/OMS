import type { InventoryMovementRow } from "@/services/inventory-service";

/**
 * R13 movement traceability (spec §3): a kit sale's component movements carry
 * the kit (`parentProductId`) and the recipe that exploded it (`recipeId`); an
 * assembly's consumption movements carry the finished product and recipe, its
 * output movement only the recipe (the moved product IS the finished item).
 */
export interface MovementTrace {
  /** The kit / assembled product the movement belongs to (null = not a recipe movement). */
  parentProductId: string | null;
  /** The product whose recipe `recipeId` is — the parent, or the moved product itself for an output. */
  recipeProductId: string | null;
  recipeId: string | null;
}

export function movementTrace(
  row: Pick<InventoryMovementRow, "productId" | "parentProductId" | "recipeId">,
): MovementTrace {
  const parentProductId = row.parentProductId ?? null;
  const recipeId = row.recipeId ?? null;
  return {
    parentProductId,
    recipeId,
    recipeProductId: recipeId ? (parentProductId ?? row.productId) : null,
  };
}

export function hasMovementTrace(trace: MovementTrace): boolean {
  return trace.parentProductId !== null || trace.recipeId !== null;
}
