import { describe, expect, it } from "vitest";
import type { RecipeRow } from "@/services/products-service";
import {
  copySource,
  defaultVersion,
  draftFromRecipe,
  draftIssues,
  draftToInput,
  emptyDraft,
  isDraftDirty,
  type RecipeDraft,
} from "./recipe-draft";

function recipe(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: "r-1",
    version: 1,
    status: "DRAFT",
    effectiveFrom: null,
    outputQuantity: 1,
    directCostEstimate: null,
    notes: null,
    lines: [],
    ...overrides,
  };
}

const line = (overrides: Partial<RecipeDraft["lines"][number]> = {}) => ({
  key: "k1",
  componentProductId: "c-1",
  label: "SKU-1 · Part",
  quantity: "2",
  unitId: "u-1",
  ...overrides,
});

const draft = (overrides: Partial<RecipeDraft> = {}): RecipeDraft => ({
  ...emptyDraft(),
  lines: [line()],
  ...overrides,
});

describe("version selection", () => {
  const versions = [
    recipe({ id: "r-1", version: 1, status: "RETIRED" }),
    recipe({ id: "r-2", version: 2, status: "ACTIVE" }),
    recipe({ id: "r-3", version: 3, status: "DRAFT" }),
  ];

  it("shows the ACTIVE version first, else the newest DRAFT, else the newest", () => {
    expect(defaultVersion(versions)?.id).toBe("r-2");
    expect(defaultVersion([versions[0], versions[2]])?.id).toBe("r-3");
    expect(defaultVersion([versions[0]])?.id).toBe("r-1");
    expect(defaultVersion([])).toBeNull();
  });

  it("'New version' copies the active version, else the newest", () => {
    expect(copySource(versions)?.id).toBe("r-2");
    expect(copySource([versions[0], versions[2]])?.id).toBe("r-3");
    expect(copySource([])).toBeNull();
  });
});

describe("draft ↔ recipe", () => {
  it("loads lines in sort order with a readable label and keeps the saved id", () => {
    const loaded = draftFromRecipe(
      recipe({
        id: "r-9",
        outputQuantity: "4",
        directCostEstimate: "5.00",
        lines: [
          {
            id: "l-2",
            componentProductId: "c-2",
            componentName: "Lid",
            componentSku: "SKU-2",
            quantity: "1",
            unitId: "u-1",
            unitName: "pcs",
            sortOrder: 2,
          },
          {
            id: "l-1",
            componentProductId: "c-1",
            componentName: "Box",
            componentSku: "SKU-1",
            quantity: "2.5",
            unitId: "u-1",
            unitName: "pcs",
            sortOrder: 1,
          },
        ],
      }),
    );
    expect(loaded.id).toBe("r-9");
    expect(loaded.outputQuantity).toBe("4");
    expect(loaded.directCostEstimate).toBe("5.00");
    expect(loaded.lines.map((l) => l.componentProductId)).toEqual(["c-1", "c-2"]);
    expect(loaded.lines[0].label).toBe("SKU-1 · Box");
  });

  it("an assembled body carries the batch output and the direct-cost ESTIMATE", () => {
    const body = draftToInput(
      draft({ outputQuantity: "12", directCostEstimate: "5.5" }),
      "ASSEMBLED",
    );
    expect(body).toMatchObject({ outputQuantity: 12, directCostEstimate: 5.5 });
    expect(body.lines).toEqual([{ componentProductId: "c-1", quantity: "2", unitId: "u-1" }]);
  });

  it("a kit body is always output 1 and never carries a direct-cost estimate", () => {
    const body = draftToInput(draft({ outputQuantity: "7", directCostEstimate: "9" }), "KIT");
    expect(body.outputQuantity).toBe(1);
    expect(body).not.toHaveProperty("directCostEstimate");
  });

  it("an empty direct-cost estimate is null (clears it), not zero", () => {
    expect(draftToInput(draft(), "ASSEMBLED").directCostEstimate).toBeNull();
  });

  it("detects unsaved edits", () => {
    const saved = draft();
    expect(isDraftDirty(saved, saved)).toBe(false);
    expect(isDraftDirty({ ...saved, lines: [line({ quantity: "3" })] }, saved)).toBe(true);
  });
});

describe("draft issues", () => {
  it("a complete draft has none", () => {
    expect(draftIssues(draft(), "KIT")).toEqual([]);
    expect(
      draftIssues(draft({ outputQuantity: "10", directCostEstimate: "0" }), "ASSEMBLED"),
    ).toEqual([]);
  });

  it("flags an empty recipe, incomplete lines and a repeated component", () => {
    expect(draftIssues(draft({ lines: [] }), "KIT")).toEqual(["NO_LINES"]);
    expect(draftIssues(draft({ lines: [line({ quantity: "0" })] }), "KIT")).toContain(
      "LINE_INCOMPLETE",
    );
    expect(draftIssues(draft({ lines: [line({ unitId: "" })] }), "KIT")).toContain(
      "LINE_INCOMPLETE",
    );
    expect(
      draftIssues(draft({ lines: [line(), line({ key: "k2", quantity: "1" })] }), "KIT"),
    ).toContain("DUPLICATE_COMPONENT");
  });

  it("an assembled batch needs an output of at least 1 and a non-negative direct cost; a kit ignores both", () => {
    expect(draftIssues(draft({ outputQuantity: "0.5" }), "ASSEMBLED")).toContain("OUTPUT_INVALID");
    expect(draftIssues(draft({ outputQuantity: "" }), "ASSEMBLED")).toContain("OUTPUT_INVALID");
    expect(draftIssues(draft({ directCostEstimate: "-1" }), "ASSEMBLED")).toContain(
      "DIRECT_COST_INVALID",
    );
    expect(draftIssues(draft({ outputQuantity: "0", directCostEstimate: "-1" }), "KIT")).toEqual(
      [],
    );
  });
});
