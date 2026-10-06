// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SelectorRow } from "./selector-row";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") && !path.endsWith(".spec.tsx") ? [path] : [];
  });
}

/** Colour-bearing utilities — text sizes / alignment are not colour. */
const COLOUR_UTILITY =
  /(?:^|[\s"'`:])(?:bg-|border-(?!b\b|t\b|s\b|e\b|x\b|y\b)|text-(?!caption|body|label|small|xs|sm|base|start|end|center|left|right|ellipsis|wrap|nowrap|pretty|balance|title|display|heading|metric|micro|code|lg|xl)|shadow-|ring-|!bg|hover:bg|data-\[state=open\]:bg)/;

describe("selector triggers keep one shared colour (design-system §12.14 / §12.15)", () => {
  it("no select / field / menu trigger overrides its colour locally", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const opening = /<(SelectTrigger|EnterpriseButton|Button)\b([^>]*?)>/g;
      for (const match of source.matchAll(opening)) {
        const [, tag, attrs] = match;
        const isTrigger = tag === "SelectTrigger" || /variant="(?:field|menu)"/.test(attrs);
        if (!isTrigger) continue;
        // `ghost` SelectTrigger = the semantic status cell; it owns its colours.
        if (tag === "SelectTrigger" && /variant="ghost"/.test(attrs)) continue;
        const classes = [...attrs.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)]
          .map((m) => m[1] ?? m[2])
          .join(" ");
        if (COLOUR_UTILITY.test(classes)) {
          offenders.push(`${file.slice(SRC.length + 1)} <${tag}> ${classes.replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the default (standalone) trigger shade is tone 3 in light and dark", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const darkStart = css.indexOf(".dark {");
    expect(darkStart).toBeGreaterThan(0);
    for (const scope of [css.slice(0, darkStart), css.slice(darkStart)]) {
      expect(scope).toMatch(/--selector:\s*var\(--toolbar-tone-3\);/);
      expect(scope).toMatch(/--selector-hover:\s*var\(--toolbar-tone-3-hover\);/);
      expect(scope).toMatch(/--selector-active:\s*var\(--toolbar-tone-3-active\);/);
    }
  });

  it("orders the ramp light → deep: tone 1 (inline-start) is the lightest, tone 5 the deepest (D-A3)", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const darkStart = css.indexOf(".dark {");
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const blue = css.match(/--ramp-blue:\s*(#[0-9a-f]{6});/i)?.[1];
    const navy = css.match(/--ramp-navy:\s*(#[0-9a-f]{6});/i)?.[1];
    expect(blue && navy && luminance(blue) > luminance(navy)).toBe(true);
    for (const scope of [css.slice(0, darkStart), css.slice(darkStart)]) {
      // Each tone mixes the lighter ramp blue into a deep navy; a plain colour is the navy itself.
      const blueShare = [1, 2, 3, 4, 5].map((n) => {
        const value = scope.match(new RegExp(`--toolbar-tone-${n}:\\s*([^;]+);`))?.[1] ?? "";
        expect(value).not.toBe("");
        return Number(value.match(/var\(--ramp-blue\)\s*(\d+)%/)?.[1] ?? 0);
      });
      for (let i = 1; i < blueShare.length; i += 1) {
        expect(blueShare[i]).toBeLessThan(blueShare[i - 1]);
      }
      expect(blueShare[0]).toBeGreaterThan(blueShare[4]);
    }
  });
});

describe("SelectorRow", () => {
  afterEach(cleanup);

  it("steps its selector controls through the tones in logical order (tone 1 = lightest at the inline-start)", () => {
    const { container } = render(
      <SelectorRow>
        <button data-select-trigger="" />
        <button data-button="" data-variant="field" />
        <button data-button="" data-variant="menu" />
      </SelectorRow>,
    );
    const tones = [...container.querySelectorAll("button")].map((b) =>
      b.getAttribute("data-toolbar-tone"),
    );
    expect(tones).toEqual(["1", "2", "3"]);
  });

  it("does not recolour earlier controls when a later conditional one appears", () => {
    const row = (withExtra: boolean) =>
      render(
        <SelectorRow>
          <button data-select-trigger="" />
          <button data-select-trigger="" />
          {withExtra ? <button data-select-trigger="" /> : null}
        </SelectorRow>,
      );
    const without = row(false);
    const before = [...without.container.querySelectorAll("button")].map((b) =>
      b.getAttribute("data-toolbar-tone"),
    );
    without.unmount();
    const withExtra = row(true);
    const after = [...withExtra.container.querySelectorAll("button")].map((b) =>
      b.getAttribute("data-toolbar-tone"),
    );
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toEqual(["1", "2", "3"]);
  });

  it("leaves an ungrouped trigger without a tone (it keeps the default shade)", () => {
    const { container } = render(<button data-select-trigger="" />);
    expect(container.querySelector("button")?.hasAttribute("data-toolbar-tone")).toBe(false);
  });
});
