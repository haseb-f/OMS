import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { actionTone, MENU_TONES, menuToneAttribute } from "./menu-tone";
import { rowActionTone } from "@/components/shared/data-table/row-actions-menu";

const SRC = `${resolve(__dirname, "../..")}/`;
const read = (path: string) => readFileSync(`${SRC}${path}`, "utf8");

/** R14 W1 (spec-1 §3) — semantic menu-item tones. */
describe("actionTone (the one verb → tone map)", () => {
  it.each([
    ["create", "success"],
    ["approve", "success"],
    ["confirm", "success"],
    ["post", "success"],
    ["deliver", "success"],
    ["activate", "success"],
    ["add-child", "success"],
    ["markPaid", "success"],
    ["hold", "warning"],
    ["suspend", "warning"],
    ["reopen", "warning"],
    ["review", "warning"],
    ["resetPassword", "warning"],
    ["delete", "destructive"],
    ["cancel", "destructive"],
    ["cancel-refund", "destructive"],
    ["archive", "destructive"],
    ["reject", "destructive"],
    ["void", "destructive"],
    ["view", "neutral"],
    ["print", "neutral"],
    ["export", "neutral"],
    ["copy", "neutral"],
    ["edit", "neutral"],
    ["reset-layout", "neutral"],
    ["duplicate-review", "neutral"],
    ["info", "info"],
  ])("%s → %s", (kind, tone) => {
    expect(actionTone(kind)).toBe(tone);
  });

  it("an explicit RowAction tone wins, then `destructive`, then the verb map", () => {
    expect(rowActionTone({ key: "approve", tone: "info" })).toBe("info");
    expect(rowActionTone({ key: "unlink-anything", destructive: true })).toBe("destructive");
    expect(rowActionTone({ key: "approve" })).toBe("success");
    expect(rowActionTone({ key: "open" })).toBe("neutral");
  });

  it("neutral leaves the item unmarked (default look)", () => {
    expect(menuToneAttribute("neutral")).toBeUndefined();
    expect(menuToneAttribute(undefined)).toBeUndefined();
    expect(menuToneAttribute("warning")).toBe("warning");
  });
});

describe("DropdownMenuItem tone", () => {
  afterEach(cleanup);

  it("marks toned items, keeps `variant=destructive` as an alias and neutral unmarked", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem tone="success">Approve</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
          <DropdownMenuItem tone="warning" disabled>
            Hold
          </DropdownMenuItem>
          <DropdownMenuItem>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = (name: string) =>
      screen.getByText(name).closest("[data-slot=dropdown-menu-item]")!;
    expect(item("Approve").getAttribute("data-menu-tone")).toBe("success");
    expect(item("Delete").getAttribute("data-menu-tone")).toBe("destructive");
    expect(item("Hold").getAttribute("data-menu-tone")).toBe("warning");
    expect(item("Hold").className).toContain("data-menu-tone:data-disabled:text-muted-foreground");
    expect(item("Edit").hasAttribute("data-menu-tone")).toBe(false);
  });

  it("scrolls long menus inside the --menu-max-height token", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>One</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const content = document.querySelector("[data-slot=dropdown-menu-content]")!;
    expect(content.className).toContain("var(--menu-max-height)");
    expect(content.className).toContain("overflow-y-auto");
  });
});

describe("--menu-tone-* tokens (≥ 4.5:1 in light and dark)", () => {
  const css = read("theme/tokens.css");
  const globals = read("app/globals.css");

  function block(source: string, selector: string, from = 0): string {
    const start = source.indexOf(`${selector} {`, from);
    expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf("}", start));
  }
  function token(source: string, name: string): string {
    const match = source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    expect(match, name).not.toBeNull();
    return match![1];
  }
  function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255]
      .map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function contrast(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  const toneStart = css.indexOf("R14 W1 (spec-1 §3)");
  const themes = [
    {
      name: "light",
      tokens: block(css, ":root", toneStart),
      popover: token(block(globals, ":root"), "popover"),
    },
    {
      name: "dark",
      tokens: block(css, ".dark", toneStart),
      popover: token(block(globals, ".dark"), "popover"),
    },
  ];

  for (const theme of themes) {
    for (const tone of MENU_TONES.filter((t) => t !== "neutral")) {
      it(`${theme.name} ${tone}: text on the popover and on its tinted background`, () => {
        const fg = token(theme.tokens, `menu-tone-${tone}`);
        const bg = token(theme.tokens, `menu-tone-${tone}-bg`);
        expect(contrast(fg, theme.popover)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("catalogue selectors stay neutral", () => {
  const pickers = readdirSync(`${SRC}components/business`)
    .filter((file) => file.endsWith("-picker.tsx"))
    .map((file) => `components/business/${file}`);
  const files = [
    "components/shared/searchable-select.tsx",
    "components/shared/entity-combobox.tsx",
    "components/shared/calling-code-picker.tsx",
    "components/shared/phone-country-selector.tsx",
    ...pickers,
  ];

  it("covers the catalogue pickers", () => {
    expect(pickers.length).toBeGreaterThan(5);
  });

  it.each(files)("%s never colours its options", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\btone=\{|\btone="|data-menu-tone|menuToneAttribute|actionTone/);
  });
});
