import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Sheet, SheetContent, SheetTitle, SHEET_SIZE_CLASSES } from "./sheet";

afterEach(cleanup);

function classesOf(size?: "sm" | "lg" | "xl") {
  render(
    <Sheet open>
      <SheetContent size={size} aria-describedby={undefined}>
        <SheetTitle>Panel</SheetTitle>
      </SheetContent>
    </Sheet>,
  );
  return screen.getByRole("dialog").className.split(/\s+/);
}

describe("SheetContent size", () => {
  it("keeps the compact default (3/4 on phones, 24rem from sm)", () => {
    const classes = classesOf();
    expect(classes).toContain("data-[side=right]:w-3/4");
    expect(classes).toContain("data-[side=right]:sm:max-w-sm");
  });

  it("xl is full width on phones and 48rem from sm — with the same data-side specificity as the base recipe", () => {
    const classes = classesOf("xl");
    expect(classes).toContain("data-[side=right]:w-full");
    expect(classes).toContain("data-[side=right]:sm:max-w-3xl");
    // The narrow defaults must be gone, otherwise they win over the wide ones.
    expect(classes).not.toContain("data-[side=right]:w-3/4");
    expect(classes).not.toContain("data-[side=right]:sm:max-w-sm");
  });

  it("lg is full width on phones and 42rem from sm", () => {
    const classes = classesOf("lg");
    expect(classes).toContain("data-[side=left]:w-full");
    expect(classes).toContain("data-[side=left]:sm:max-w-2xl");
    expect(SHEET_SIZE_CLASSES.lg).not.toMatch(/w-3\/4|max-w-sm/);
  });
});
