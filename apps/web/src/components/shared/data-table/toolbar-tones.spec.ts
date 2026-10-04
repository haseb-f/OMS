// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  TOOLBAR_TONE_ATTRIBUTE,
  TOOLBAR_TONE_COUNT,
  applyToolbarTones,
  assignToolbarTones,
} from "./toolbar-tones";

describe("assignToolbarTones", () => {
  it("numbers eligible controls 1..N in order and cycles", () => {
    const tones = assignToolbarTones(Array.from({ length: 7 }, () => ({})));
    expect(tones).toEqual([1, 2, 3, 4, 5, 1, 2]);
    expect(TOOLBAR_TONE_COUNT).toBe(5);
  });

  it("skips exempt controls without advancing the sequence", () => {
    expect(assignToolbarTones([{}, { exempt: true }, {}, {}])).toEqual([1, null, 2, 3]);
  });

  it("gives a hidden control its index so showing it never recolours its neighbours", () => {
    const visibleOnly = assignToolbarTones([{}, {}, {}]);
    const withHidden = assignToolbarTones([{}, { hidden: true }, {}, {}]);
    expect(withHidden).toEqual([1, 2, 3, 4]);
    // The control after the hidden one is 3 in both layouts' logical order
    // only because the hidden one still counts.
    expect(withHidden[2]).toBe(visibleOnly[2]);
  });

  it("honours a custom step count", () => {
    expect(assignToolbarTones([{}, {}, {}, {}], 3)).toEqual([1, 2, 3, 1]);
  });
});

function toolbar(html: string) {
  const root = document.createElement("div");
  root.setAttribute("data-slot", "list-toolbar");
  root.innerHTML = html;
  return root;
}
const tonesOf = (root: Element) =>
  Array.from(root.querySelectorAll("[data-testid]")).map((el) => [
    el.getAttribute("data-testid"),
    el.getAttribute(TOOLBAR_TONE_ATTRIBUTE),
  ]);

describe("applyToolbarTones", () => {
  it("numbers filter triggers, field/menu/outline buttons and selects in DOM order; never semantic or ghost controls", () => {
    const root = toolbar(`
      <input data-testid="search" />
      <button data-testid="f1" data-button data-variant="field" data-filter-trigger></button>
      <button data-testid="f2" data-button data-variant="field" data-filter-trigger data-active></button>
      <button data-testid="combo" data-button data-variant="field"></button>
      <button data-testid="select" data-select-trigger data-slot="select-trigger"></button>
      <button data-testid="ghost-select" data-select-trigger data-variant="ghost"></button>
      <button data-testid="archived" data-button data-variant="outline"></button>
      <button data-testid="confirm" data-button data-variant="success"></button>
      <button data-testid="delete" data-button data-variant="destructive"></button>
      <button data-testid="refresh" data-button data-variant="ghost"></button>
      <button data-testid="columns" data-button data-variant="menu"></button>
    `);
    applyToolbarTones(root);
    expect(tonesOf(root)).toEqual([
      ["search", null],
      ["f1", "1"],
      ["f2", "2"],
      ["combo", "3"],
      ["select", "4"],
      ["ghost-select", null],
      ["archived", "5"],
      ["confirm", null],
      ["delete", null],
      ["refresh", null],
      ["columns", "1"],
    ]);
  });

  it("counts controls hidden by responsive classes so wrapping/hiding never shifts the rest", () => {
    const root = toolbar(`
      <button data-testid="f1" data-button data-variant="field" data-filter-trigger></button>
      <div class="hidden @3xl:contents">
        <button data-testid="f2" data-button data-variant="field" data-filter-trigger></button>
      </div>
      <button data-testid="phone-filters" class="@3xl:hidden" data-button data-variant="menu"></button>
      <button data-testid="columns" data-button data-variant="menu"></button>
    `);
    applyToolbarTones(root);
    expect(tonesOf(root)).toEqual([
      ["f1", "1"],
      ["f2", "2"],
      ["phone-filters", "3"],
      ["columns", "4"],
    ]);
  });

  it("skips the bulk strip, data-tone-exempt subtrees and pressed-state toggles without counting them", () => {
    const root = toolbar(`
      <button data-testid="f1" data-button data-variant="field" data-filter-trigger></button>
      <button data-testid="dup-review" data-button data-variant="outline" aria-pressed="false"></button>
      <span data-tone-exempt>
        <button data-testid="exempt" data-button data-variant="menu"></button>
      </span>
      <button data-testid="legacy" data-button data-variant="outline"></button>
      <div data-bulk-strip>
        <button data-testid="print-selected" data-button data-variant="outline"></button>
      </div>
    `);
    applyToolbarTones(root);
    expect(tonesOf(root)).toEqual([
      ["f1", "1"],
      ["dup-review", null],
      ["exempt", null],
      ["legacy", "2"],
      ["print-selected", null],
    ]);
  });

  it("renumbers after the DOM changes and clears a tone that no longer applies", () => {
    const root = toolbar(`
      <button data-testid="a" data-button data-variant="field" data-filter-trigger></button>
      <button data-testid="b" data-button data-variant="field" data-filter-trigger></button>
      <button data-testid="c" data-button data-variant="outline"></button>
    `);
    applyToolbarTones(root);
    expect(tonesOf(root)).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
    root.querySelector('[data-testid="a"]')?.remove();
    root.querySelector('[data-testid="c"]')?.setAttribute("aria-pressed", "true");
    applyToolbarTones(root);
    expect(tonesOf(root)).toEqual([
      ["b", "1"],
      ["c", null],
    ]);
  });
});
