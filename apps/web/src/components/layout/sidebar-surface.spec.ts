import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * R19 §B guard — the sidebar is ONE contrasting surface (dark charcoal in the
 * light theme, soft light grey in the dark theme) drawn only from the shared
 * `--sidebar-*` tokens. No sidebar component hard-codes a colour or borrows a
 * content-surface token, no page or stylesheet overrides the sidebar colours,
 * and the theme values keep the surface on the opposite side of the canvas.
 */
const SRC = resolve(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8").replace(/\r\n/g, "\n");

/** The components drawn ON the sidebar surface (company, agent and partner shells share them). */
const SIDEBAR_COMPONENTS = [
  "components/ui/sidebar.tsx",
  "components/layout/app-sidebar.tsx",
  "components/layout/portal-identity.tsx",
];
/** `ui/sidebar.tsx` parts that are NOT on the sidebar surface: the content area and the text input (inputs keep their own colours). */
const OFF_SURFACE_PARTS = ["SidebarInset", "SidebarInput"];

/** Colour utilities that read a content-surface token, a palette colour or a literal colour. */
const FOREIGN_COLOUR =
  /(?:^|[\s"'`:])(?:bg|text|border(?:-[sexytblr])?|ring|outline|fill|stroke|divide|from|via|to|decoration|caret)-(?:primary(?:-[a-z]+)?|foreground|background|card(?:-foreground)?|popover(?:-foreground)?|muted(?:-foreground)?|accent(?:-foreground)?|secondary(?:-foreground)?|border(?:-strong)?|input|focus-ring|white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|\[(?:#|rgb|hsl|oklch|color-mix))/;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i;

function withoutParts(source: string, parts: string[]): string {
  let out = source;
  for (const name of parts) {
    const start = out.indexOf(`function ${name}(`);
    if (start < 0) continue;
    const end = out.indexOf("\n}\n", start);
    out = out.slice(0, start) + out.slice(end + 3);
  }
  return out;
}

function classStrings(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
}

function files(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (pattern.test(entry) && !/\.spec\.tsx?$/.test(entry)) out.push(path);
    }
  };
  walk(join(SRC, dir));
  return out;
}

/** The custom properties a top-level `selector { … }` block of globals.css defines. */
function tokenBlock(selector: string): Record<string, string> {
  const css = read("app/globals.css");
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(at, css.indexOf("\n}\n", at)).replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("sidebar surface (R19 §B)", () => {
  it("sidebar components read only sidebar tokens — no content-surface token, palette or literal colour", () => {
    const offenders: string[] = [];
    for (const path of SIDEBAR_COMPONENTS) {
      const source = withoutParts(read(path), OFF_SURFACE_PARTS);
      for (const value of classStrings(source)) {
        for (const token of value.split(/\s+/)) {
          if (FOREIGN_COLOUR.test(` ${token}`) || LITERAL_COLOUR.test(token)) {
            offenders.push(`${path}: ${token}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no page, component or stylesheet outside the token file overrides a sidebar colour", () => {
    const offenders: string[] = [];
    const allowedClassUsers = new Set([
      ...SIDEBAR_COMPONENTS.map((path) => join(SRC, path)),
      // The design-system reference page previews the sidebar tokens themselves.
      join(SRC, "app/(shell)/design-system/page.tsx"),
    ]);
    for (const path of [...files("app", /\.tsx?$/), ...files("components", /\.tsx?$/)]) {
      const source = readFileSync(path, "utf8");
      if (
        !allowedClassUsers.has(path) &&
        /(?:bg|text|border|ring|outline)-sidebar[\w-]*/.test(source)
      ) {
        offenders.push(`${relative(SRC, path)}: sidebar colour class`);
      }
      // Inline overrides of a sidebar colour token (width tokens are layout, not colour).
      if (/["'`]--sidebar(?!-width)[\w-]*["'`]\s*:/.test(source)) {
        offenders.push(`${relative(SRC, path)}: inline --sidebar token`);
      }
    }
    for (const path of [...files("theme", /\.css$/)]) {
      const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/--sidebar(?!-width)[\w-]*\s*:/.test(source)) {
        offenders.push(`${relative(SRC, path)}: redefines a sidebar colour token`);
      }
      if (
        /\[data-slot="sidebar[\w-]*"\][^{]*\{[^}]*(?:color|background|border-color)\s*:/.test(
          source,
        )
      ) {
        offenders.push(`${relative(SRC, path)}: recolours a sidebar slot`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the sidebar contrasts with the canvas: charcoal on the light theme, soft light grey on the dark theme", () => {
    const light = tokenBlock(":root");
    const dark = tokenBlock(".dark");
    expect(light.sidebar).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dark.sidebar).toMatch(/^#[0-9a-f]{6}$/i);
    expect(luminance(light.sidebar)).toBeLessThan(0.05);
    expect(luminance(dark.sidebar)).toBeGreaterThan(0.7);
    // Not pure white on the dark canvas (no glare) and not pure black on the light one.
    expect(dark.sidebar.toLowerCase()).not.toBe("#ffffff");
    expect(light.sidebar.toLowerCase()).not.toBe("#000000");
    for (const theme of [light, dark]) {
      for (const token of [
        "sidebar-foreground",
        "sidebar-muted-foreground",
        "sidebar-primary",
        "sidebar-accent",
        "sidebar-accent-foreground",
        "sidebar-active",
        "sidebar-border",
        "sidebar-ring",
        "sidebar-rail",
        "sidebar-rail-glow",
        "sidebar-raised",
        "sidebar-chip",
        "sidebar-chip-foreground",
        "sidebar-scrollbar-thumb",
      ]) {
        expect(theme[token], `--${token}`).toBeTruthy();
      }
    }
  });

  it("shared controls placed on the sidebar read the sidebar tokens through the one surface rule", () => {
    const rule = tokenBlock('[data-slot="sidebar"]');
    expect(rule.foreground).toBe("var(--sidebar-foreground)");
    expect(rule["btn-soft-hover"]).toBe("var(--sidebar-accent)");
    expect(rule["btn-soft-pressed"]).toBe("var(--sidebar-active)");
    expect(rule["focus-ring"]).toBe("var(--sidebar-ring)");
    expect(rule["scrollbar-thumb"]).toBe("var(--sidebar-scrollbar-thumb)");
    // Selector triggers (the company selector) keep the one-blue selector colours.
    expect(Object.keys(rule).some((name) => name.startsWith("selector"))).toBe(false);
  });

  it("desktop column and mobile drawer both carry the sidebar surface slot", () => {
    const source = read("components/ui/sidebar.tsx");
    expect(source).toMatch(/data-slot="sidebar"\s+data-mobile="true"/);
    expect(source.match(/data-slot="sidebar"\n/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
