import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api-client";
import type { AssemblyPreview } from "@/services/assembly-service";
import {
  assemblyBlockerMessage,
  assemblyErrorMessage,
  canViewAssemblyCost,
  normalizeDirectCost,
  parseAssemblyQuantity,
  summarizeAssemblyPreview,
} from "./assembly";

/** Echoes the key and its params so assertions read the mapping, not a dictionary. */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}${JSON.stringify(params)}` : key;

function preview(overrides: Partial<AssemblyPreview> = {}): AssemblyPreview {
  return {
    canAssemble: true,
    blockers: [],
    recipe: { id: "r-1", version: 3 },
    lines: [],
    componentCost: null,
    directCostEstimate: null,
    estimatedUnitCost: null,
    maximumQuantity: 0,
    ...overrides,
  };
}

const line = (id: string, quantity: number, available: number) => ({
  componentProductId: id,
  name: id,
  quantity,
  available,
  unitCost: null,
  value: null,
});

describe("summarizeAssemblyPreview", () => {
  it("marks the component covering the smallest share of its need as limiting", () => {
    // A: 10 needed / 50 available (5x) · B: 4 needed / 6 available (1.5x) · C: 2 / 20 (10x)
    const summary = summarizeAssemblyPreview(
      preview({ lines: [line("A", 10, 50), line("B", 4, 6), line("C", 2, 20)] }),
    );
    expect(summary.limiting?.componentProductId).toBe("B");
    expect(summary.lines.map((l) => l.isLimiting)).toEqual([false, true, false]);
    expect(summary.shortages).toEqual([]);
  });

  it("reports every shortage with the missing units, and the worst one as limiting", () => {
    const summary = summarizeAssemblyPreview(
      preview({ canAssemble: false, lines: [line("A", 10, 7), line("B", 4, 0)] }),
    );
    expect(summary.shortages.map((l) => [l.componentProductId, l.shortage])).toEqual([
      ["A", 3],
      ["B", 4],
    ]);
    expect(summary.limiting?.componentProductId).toBe("B");
  });

  it("keeps the first line on a tie and has no limiting component without lines", () => {
    expect(
      summarizeAssemblyPreview(preview({ lines: [line("A", 2, 4), line("B", 1, 2)] })).limiting
        ?.componentProductId,
    ).toBe("A");
    expect(summarizeAssemblyPreview(preview()).limiting).toBeNull();
  });
});

describe("parseAssemblyQuantity / normalizeDirectCost", () => {
  it("accepts whole positive quantities only", () => {
    expect(parseAssemblyQuantity("3")).toBe(3);
    expect(parseAssemblyQuantity(" 12 ")).toBe(12);
    for (const bad of ["", "0", "-1", "1.5", "abc", "1e3", "1000000001"]) {
      expect(parseAssemblyQuantity(bad)).toBeNull();
    }
  });

  it("treats empty or zero as no direct cost and rejects more than two decimals", () => {
    expect(normalizeDirectCost("")).toEqual({ ok: true });
    expect(normalizeDirectCost("0")).toEqual({ ok: true });
    expect(normalizeDirectCost("5")).toEqual({ ok: true, value: "5" });
    expect(normalizeDirectCost("12.50")).toEqual({ ok: true, value: "12.50" });
    expect(normalizeDirectCost("1.234").ok).toBe(false);
    expect(normalizeDirectCost("-3").ok).toBe(false);
  });
});

describe("canViewAssemblyCost", () => {
  it("mirrors the controller: inventory cost visibility or the direct-cost right", () => {
    expect(canViewAssemblyCost((p) => p === "expenses.view")).toBe(true);
    expect(canViewAssemblyCost((p) => p === "inventory.assembly.direct_cost")).toBe(true);
    expect(canViewAssemblyCost((p) => p === "inventory.view")).toBe(false);
  });
});

describe("assembly error mapping", () => {
  const apiError = (status: number, body: Record<string, unknown>, message = "server text") =>
    new ApiError(status, message, "SERVER_ERROR", undefined, undefined, body);

  it("names every short component of ASSEMBLY_INSUFFICIENT_STOCK", () => {
    const error = apiError(422, {
      code: "ASSEMBLY_INSUFFICIENT_STOCK",
      shortages: [
        { productId: "a", sku: "SKU-A", name: "Box", required: 4, available: 1 },
        { productId: "b", sku: "SKU-B", name: "Lid", required: 2, available: 0 },
      ],
    });
    expect(assemblyErrorMessage(error, t)).toBe(
      'assembly.errors.ASSEMBLY_INSUFFICIENT_STOCK assembly.errors.shortageItem{"name":"SKU-A Box","required":4,"available":1}assembly.errors.listSeparatorassembly.errors.shortageItem{"name":"SKU-B Lid","required":2,"available":0}',
    );
  });

  it("explains an already-consumed output with the quantities", () => {
    const error = apiError(409, { code: "ASSEMBLY_OUTPUT_CONSUMED", required: 5, available: 2 });
    expect(assemblyErrorMessage(error, t)).toBe(
      'assembly.errors.ASSEMBLY_OUTPUT_CONSUMED_DETAIL{"required":5,"available":2}',
    );
    expect(assemblyErrorMessage(apiError(409, { code: "ASSEMBLY_OUTPUT_CONSUMED" }), t)).toBe(
      "assembly.errors.ASSEMBLY_OUTPUT_CONSUMED",
    );
  });

  it("appends the server detail only for codes that name products", () => {
    expect(assemblyErrorMessage(apiError(422, { code: "ASSEMBLY_OWNER_MIXED" }, "A vs B"), t)).toBe(
      "assembly.errors.ASSEMBLY_OWNER_MIXED A vs B",
    );
    expect(
      assemblyErrorMessage(apiError(422, { code: "ASSEMBLY_COST_ACCOUNT_MISSING" }, "x"), t),
    ).toBe("assembly.errors.ASSEMBLY_COST_ACCOUNT_MISSING");
    expect(assemblyErrorMessage(apiError(409, { code: "ASSEMBLY_IDEMPOTENCY_MISMATCH" }), t)).toBe(
      "assembly.errors.ASSEMBLY_IDEMPOTENCY_MISMATCH",
    );
  });

  it("returns null for anything that is not an assembly code", () => {
    expect(assemblyErrorMessage(apiError(500, { code: "SOMETHING_ELSE" }), t)).toBeNull();
    expect(assemblyErrorMessage(new Error("boom"), t)).toBeNull();
  });

  it("localizes preview blockers and keeps unknown ones as sent", () => {
    expect(
      assemblyBlockerMessage({ code: "ASSEMBLY_NO_ACTIVE_RECIPE", message: "en text" }, t),
    ).toBe("assembly.errors.ASSEMBLY_NO_ACTIVE_RECIPE");
    expect(
      assemblyBlockerMessage({ code: "ASSEMBLY_FRACTIONAL_CONSUMPTION", message: "SKU-1" }, t),
    ).toBe("assembly.errors.ASSEMBLY_FRACTIONAL_CONSUMPTION SKU-1");
    expect(assemblyBlockerMessage({ code: "NEW_CODE", message: "as sent" }, t)).toBe("as sent");
  });
});
