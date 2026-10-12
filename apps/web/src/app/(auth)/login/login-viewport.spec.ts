import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R16 (spec-1) — guards for the sign-in / mobile-viewport fix:
 * - touch text inputs render at ≥16px (iOS Safari otherwise zooms on focus and
 *   keeps the zoom after the post-login redirect);
 * - the viewport never restricts pinch-zoom;
 * - the sign-in password offers reveal/hide but no copy action.
 */
const src = join(__dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(src, path), "utf8");

describe("R16 login + viewport", () => {
  it("renders touch text inputs at 16px or more", () => {
    const css = read("theme/recipes.css").replace(/\s+/g, " ");
    expect(css).toMatch(/@media \(pointer: coarse\) \{ :is\( input:not\(/);
    expect(css).toContain("font-size: max(1rem, 16px);");
  });

  it("declares a viewport without zoom restrictions", () => {
    const layout = read("app/layout.tsx");
    const viewport = layout.slice(layout.indexOf("export const viewport: Viewport"));
    const block = viewport.slice(0, viewport.indexOf("};"));
    expect(block).toContain('interactiveWidget: "resizes-content"');
    expect(block).not.toMatch(/maximumScale|userScalable/);
  });

  it("R18 §C: sign-in fields and the submit button share the 44px auth height, text stays 16px", () => {
    const tokens = read("theme/tokens.css");
    // R17 §5 set 46px (2.875rem); R18 §C −2px → 44px, still a 44px touch target.
    expect(tokens).toMatch(/--auth-control-height: 2\.75rem;/);
    const css = read("theme/recipes.css").replace(/\s+/g, " ");
    expect(css).toMatch(
      /\.oms-auth-form input:not\(\[type="checkbox"\]\) \{ height: var\(--auth-control-height\);[^}]*font-size: 1rem;/,
    );
    expect(css).toMatch(
      /\.oms-auth-submit \{ height: var\(--auth-control-height\);[^}]*font-size: 1rem;/,
    );
    // The 40px reveal/hide button still fits inside the 44px field (no overflow, centred).
    expect(css).toMatch(
      /\.oms-auth-form \[data-slot="password-input"\] button \{ width: 2\.5rem; height: 2\.5rem; \}/,
    );
    expect(tokens).not.toMatch(/--auth-control-height: (2\.875|3\.125)rem;/);
  });

  it("keeps reveal/hide but drops copy on the sign-in password", () => {
    const page = read("app/(auth)/login/page.tsx");
    expect(page).toMatch(/autoComplete="current-password"[\s\S]*copyable=\{false\}/);
    expect(page).not.toMatch(/generatable/);
  });
});
