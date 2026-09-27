import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn — OMS typography utilities", () => {
  it("keeps an OMS size next to a text color", () => {
    expect(cn("text-caption text-muted-foreground")).toBe("text-caption text-muted-foreground");
    expect(cn("text-table-head", "text-table-header-foreground")).toBe(
      "text-table-head text-table-header-foreground",
    );
  });
  it("lets a later OMS size override an earlier one", () => {
    expect(cn("text-body", "text-caption")).toBe("text-caption");
    expect(cn("text-sm", "text-metric")).toBe("text-metric");
  });
  it("still merges colors", () => {
    expect(cn("text-foreground", "text-primary")).toBe("text-primary");
  });
});
