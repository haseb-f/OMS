// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ControlSurface } from "@/components/ui/control-surface";
import { EnterpriseButton } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SelectorRow } from "@/components/shared/selector-row";
import { ListToolbar } from "@/components/shared/data-table/list-surface";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");

const trigger = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-select-trigger]")!;

function renderSelect(surfaceProp?: "toolbar" | "form") {
  return (
    <Select>
      <SelectTrigger surface={surfaceProp}>
        <SelectValue placeholder="x" />
      </SelectTrigger>
    </Select>
  );
}

describe("ControlSurface (design-system §12.23)", () => {
  afterEach(cleanup);

  it("a select outside any container keeps the toolbar appearance", () => {
    const { container } = render(renderSelect());
    expect(trigger(container).dataset.surface).toBe("toolbar");
  });

  it("a select inside a form surface (dialogs, sheets, forms) is the light form variant", () => {
    const { container } = render(<ControlSurface surface="form">{renderSelect()}</ControlSurface>);
    expect(trigger(container).dataset.surface).toBe("form");
  });

  it("a list toolbar / selector row inside a form keeps the stronger toolbar variant", () => {
    const { container } = render(
      <ControlSurface surface="form">
        <SelectorRow>{renderSelect()}</SelectorRow>
        <ListToolbar>{renderSelect()}</ListToolbar>
      </ControlSurface>,
    );
    const surfaces = [...container.querySelectorAll<HTMLElement>("[data-select-trigger]")].map(
      (el) => el.dataset.surface,
    );
    expect(surfaces).toEqual(["toolbar", "toolbar"]);
  });

  it("an explicit surface prop beats the container", () => {
    const { container } = render(
      <ControlSurface surface="form">{renderSelect("toolbar")}</ControlSurface>,
    );
    expect(trigger(container).dataset.surface).toBe("toolbar");
  });

  it("a ghost (status cell) trigger carries no surface", () => {
    const { container } = render(
      <ControlSurface surface="form">
        <Select>
          <SelectTrigger variant="ghost">
            <SelectValue placeholder="x" />
          </SelectTrigger>
        </Select>
      </ControlSurface>,
    );
    expect(trigger(container).hasAttribute("data-surface")).toBe(false);
  });

  it("only a field trigger takes a surface; menu and action buttons never do", () => {
    const { container } = render(
      <ControlSurface surface="form">
        <EnterpriseButton variant="field">a</EnterpriseButton>
        <EnterpriseButton variant="menu">b</EnterpriseButton>
        <EnterpriseButton variant="default">c</EnterpriseButton>
      </ControlSurface>,
    );
    const attrs = [...container.querySelectorAll("button")].map((b) => b.dataset.surface);
    expect(attrs).toEqual(["form", undefined, undefined]);
  });
});

describe("form surface recipe", () => {
  const css = readFileSync(join(SRC, "theme/recipes.css"), "utf8");

  it("re-points only the selector tokens, in light and dark, and never touches a toned control", () => {
    expect(css).toMatch(/\[data-surface="form"\]:not\(\s*\[data-toolbar-tone\]\s*\)/);
    const light = css.slice(css.indexOf("Form surface for selector triggers"));
    for (const token of [
      "--selector:",
      "--selector-hover:",
      "--selector-active:",
      "--selector-foreground:",
      "--selector-muted:",
      "--selector-border:",
      "--selector-chip:",
      "--selector-open-edge:",
    ]) {
      expect(light).toContain(token);
    }
    expect(light).toMatch(/\.dark\s+:is\(/);
  });

  it("form text is the ordinary foreground (dark, readable), not the toolbar's white", () => {
    expect(css).toMatch(/--selector-foreground:\s*var\(--foreground\);/);
  });
});
