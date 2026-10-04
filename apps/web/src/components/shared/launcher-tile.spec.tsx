import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Users } from "lucide-react";
import { LauncherTile } from "./launcher-tile";

afterEach(cleanup);

describe("LauncherTile (design-system §12.17)", () => {
  it("is exactly one link carrying its tone, size and destination", () => {
    const { container } = render(
      <LauncherTile href="/crm/leads" title="CRM" tone="violet" icon={Users} caption="Leads" />,
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/crm/leads");
    expect(links[0].getAttribute("data-slot")).toBe("launcher-tile");
    expect(links[0].getAttribute("data-tone")).toBe("violet");
    expect(links[0].getAttribute("data-size")).toBe("module");
  });

  it("keeps the caption plain text, never a nested link", () => {
    const { container } = render(
      <LauncherTile href="/crm/leads" title="CRM" tone="blue" caption="Leads · Funnel" />,
    );
    expect(container.querySelector('[data-slot="launcher-caption"]')?.textContent).toBe(
      "Leads · Funnel",
    );
    expect(container.querySelectorAll("a a")).toHaveLength(0);
  });

  it("the compact action variant drops the caption", () => {
    const { container } = render(
      <LauncherTile href="/x" title="New" tone="teal" size="action" caption="hidden" />,
    );
    expect(container.querySelector('[data-slot="launcher-caption"]')).toBeNull();
  });

  it("hides decorative icon and arrow from assistive tech and keeps a visible focus ring", () => {
    const { container } = render(<LauncherTile href="/x" title="T" tone="blue" icon={Users} />);
    expect(
      container.querySelector('[data-slot="launcher-icon"]')?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      container.querySelector('[data-slot="launcher-arrow"]')?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(container.querySelector("a")?.className).toMatch(/focus-visible:outline-solid/);
  });

  it("an accessible name override is used when given", () => {
    const { container } = render(
      <LauncherTile href="/x" title="CRM" tone="blue" ariaLabel="Open CRM" />,
    );
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("Open CRM");
  });
});
