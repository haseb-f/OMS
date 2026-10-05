import { ApiError } from "@/services/api-client";
import type { AssemblyPreview, AssemblyStatus } from "@/services/assembly-service";
import type { StatusTone } from "@/components/business/status-tone";
import type { MessageKey } from "@/i18n/translate";
import { apiErrorCode } from "@/config/products/product-errors";
import { canViewInventoryCost } from "./cost-visibility";

/**
 * R13 assembly orders — the pure rules behind the assembly screens (api-contract.md §4).
 * No React; unit-tested in `assembly.spec.ts`. The server stays the authority: the
 * preview's blockers are what `POST /assembly` enforces, these helpers only explain them.
 */

export const ASSEMBLY_ROUTE = "/inventory/assembly";

export function assemblyHref(id: string): string {
  return `${ASSEMBLY_ROUTE}/${id}`;
}

export const ASSEMBLY_STATUSES: AssemblyStatus[] = ["POSTED", "REVERSED"];

export const ASSEMBLY_STATUS_TONE: Record<AssemblyStatus, StatusTone> = {
  POSTED: "success",
  REVERSED: "neutral",
};

/** Permissions of the assembly module (API permission catalog, module `assembly`). */
export const ASSEMBLY_PERMISSIONS = {
  view: "inventory.view",
  create: "inventory.assembly.create",
  reverse: "inventory.assembly.reverse",
  directCost: "inventory.assembly.direct_cost",
} as const;

/** Mirrors the controller: inventory-cost visibility, or the right to enter a direct cost. */
export function canViewAssemblyCost(hasPermission: (permission: string) => boolean): boolean {
  return canViewInventoryCost(hasPermission) || hasPermission(ASSEMBLY_PERMISSIONS.directCost);
}

/** A whole, positive quantity the API accepts (`Int`, 1 … 1e9), or null. */
export function parseAssemblyQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const quantity = Number(trimmed);
  return quantity >= 1 && quantity <= 1_000_000_000 ? quantity : null;
}

/** A direct cost the API accepts: empty (none) or ≥ 0 with at most 2 decimals. */
export function normalizeDirectCost(value: string): { ok: boolean; value?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true };
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  return Number(trimmed) > 0 ? { ok: true, value: trimmed } : { ok: true };
}

export interface PreviewLineView {
  componentProductId: string;
  name: string;
  /** Needed for the requested quantity (whole stock units). */
  needed: number;
  available: number;
  /** Missing units (0 when covered). */
  shortage: number;
  /** The component that allows the fewest finished units. */
  isLimiting: boolean;
  unitCost: string | null;
  value: string | null;
}

export interface PreviewSummary {
  lines: PreviewLineView[];
  limiting: PreviewLineView | null;
  shortages: PreviewLineView[];
}

/**
 * Need vs available per component, the shortages and the LIMITING component —
 * the one whose stock covers the smallest share of what the requested quantity
 * needs (`available / needed`, ties → first line). Every line's need scales with
 * the same quantity, so this is also the component that caps `maximumQuantity`.
 */
export function summarizeAssemblyPreview(preview: AssemblyPreview): PreviewSummary {
  let limitingIndex = -1;
  let lowestCoverage = Number.POSITIVE_INFINITY;
  preview.lines.forEach((line, index) => {
    if (line.quantity <= 0) return;
    const coverage = line.available / line.quantity;
    if (coverage < lowestCoverage) {
      lowestCoverage = coverage;
      limitingIndex = index;
    }
  });
  const lines = preview.lines.map<PreviewLineView>((line, index) => ({
    componentProductId: line.componentProductId,
    name: line.name,
    needed: line.quantity,
    available: line.available,
    shortage: Math.max(0, line.quantity - line.available),
    isLimiting: index === limitingIndex,
    unitCost: line.unitCost,
    value: line.value,
  }));
  return {
    lines,
    limiting: limitingIndex >= 0 ? lines[limitingIndex] : null,
    shortages: lines.filter((line) => line.shortage > 0),
  };
}

/** Localized sentences for the preview blockers and the create / reverse failures. */
export const ASSEMBLY_ERROR_KEYS = {
  ASSEMBLY_INSUFFICIENT_STOCK: "assembly.errors.ASSEMBLY_INSUFFICIENT_STOCK",
  ASSEMBLY_NO_ACTIVE_RECIPE: "assembly.errors.ASSEMBLY_NO_ACTIVE_RECIPE",
  ASSEMBLY_NOT_ASSEMBLED_PRODUCT: "assembly.errors.ASSEMBLY_NOT_ASSEMBLED_PRODUCT",
  ASSEMBLY_WAREHOUSE_INACTIVE: "assembly.errors.ASSEMBLY_WAREHOUSE_INACTIVE",
  ASSEMBLY_OWNER_MIXED: "assembly.errors.ASSEMBLY_OWNER_MIXED",
  ASSEMBLY_FRACTIONAL_CONSUMPTION: "assembly.errors.ASSEMBLY_FRACTIONAL_CONSUMPTION",
  RECIPE_UNIT_CONVERSION_MISSING: "assembly.errors.RECIPE_UNIT_CONVERSION_MISSING",
  ASSEMBLY_COST_ACCOUNT_MISSING: "assembly.errors.ASSEMBLY_COST_ACCOUNT_MISSING",
  ASSEMBLY_DIRECT_COST_FORBIDDEN: "assembly.errors.ASSEMBLY_DIRECT_COST_FORBIDDEN",
  ASSEMBLY_AGENT_DIRECT_COST: "assembly.errors.ASSEMBLY_AGENT_DIRECT_COST",
  ASSEMBLY_IDEMPOTENCY_MISMATCH: "assembly.errors.ASSEMBLY_IDEMPOTENCY_MISMATCH",
  ASSEMBLY_RECIPE_CHANGED: "assembly.errors.ASSEMBLY_RECIPE_CHANGED",
  ASSEMBLY_OUTPUT_CONSUMED: "assembly.errors.ASSEMBLY_OUTPUT_CONSUMED",
  ASSEMBLY_NOT_POSTED: "assembly.errors.ASSEMBLY_NOT_POSTED",
  ASSEMBLY_NOT_FOUND: "assembly.errors.ASSEMBLY_NOT_FOUND",
  INVENTORY_DUPLICATE_MOVEMENT: "assembly.errors.INVENTORY_DUPLICATE_MOVEMENT",
} as const satisfies Record<string, MessageKey>;

export type AssemblyErrorCode = keyof typeof ASSEMBLY_ERROR_KEYS;

/** Codes whose server message names the products / path involved — appended as a detail. */
const DETAIL_CODES: ReadonlySet<string> = new Set<AssemblyErrorCode>([
  "ASSEMBLY_OWNER_MIXED",
  "ASSEMBLY_FRACTIONAL_CONSUMPTION",
  "RECIPE_UNIT_CONVERSION_MISSING",
]);

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function isAssemblyErrorCode(code: string | undefined): code is AssemblyErrorCode {
  return code !== undefined && code in ASSEMBLY_ERROR_KEYS;
}

/** The localized sentence for one preview blocker; unknown codes keep the server's message. */
export function assemblyBlockerMessage(
  blocker: { code: string; message: string },
  translate: Translate,
): string {
  if (!isAssemblyErrorCode(blocker.code)) return blocker.message;
  const base = translate(ASSEMBLY_ERROR_KEYS[blocker.code]);
  return DETAIL_CODES.has(blocker.code) && blocker.message ? `${base} ${blocker.message}` : base;
}

interface Shortage {
  name: string;
  required: number;
  available: number;
}

function shortagesFromBody(body: Record<string, unknown> | undefined): Shortage[] {
  const raw = body?.shortages;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { name, sku, required, available } = item as Record<string, unknown>;
    if (typeof required !== "number" || typeof available !== "number") return [];
    const label = [sku, name].filter((part) => typeof part === "string" && part).join(" ");
    return [{ name: label, required, available }];
  });
}

/**
 * The localized explanation of a failed create / reverse, or null when the
 * failure is not an assembly business code (the caller then falls back to the
 * shared API error toast). Insufficient stock names every short component; an
 * already-consumed output says how much is left and what to do instead.
 */
export function assemblyErrorMessage(error: unknown, translate: Translate): string | null {
  const code = apiErrorCode(error);
  if (!isAssemblyErrorCode(code)) return null;
  const body = error instanceof ApiError ? error.body : undefined;
  if (code === "ASSEMBLY_INSUFFICIENT_STOCK") {
    const shortages = shortagesFromBody(body);
    const base = translate(ASSEMBLY_ERROR_KEYS[code]);
    if (shortages.length === 0) return base;
    return `${base} ${shortages
      .map((item) =>
        translate("assembly.errors.shortageItem", {
          name: item.name,
          required: item.required,
          available: item.available,
        }),
      )
      .join(translate("assembly.errors.listSeparator"))}`;
  }
  if (code === "ASSEMBLY_OUTPUT_CONSUMED") {
    const required = body?.required;
    const available = body?.available;
    if (typeof required === "number" && typeof available === "number") {
      return translate("assembly.errors.ASSEMBLY_OUTPUT_CONSUMED_DETAIL", { required, available });
    }
  }
  const base = translate(ASSEMBLY_ERROR_KEYS[code]);
  if (!DETAIL_CODES.has(code) || !(error instanceof ApiError)) return base;
  const detail = error.message.trim();
  return detail && detail !== base ? `${base} ${detail}` : base;
}
