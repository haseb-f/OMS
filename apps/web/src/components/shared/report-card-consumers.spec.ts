import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * R17 §4 guard — every report summary card is the shared card, styled only by
 * the one recipe + tokens. No consumer (pages, panels, report views, portals)
 * styles a card locally: a card's `className` may only place it in its grid
 * (column / row span, height, self-alignment), and a card group may only set
 * its columns and its panel inset. The retired `KpiCard` never comes back.
 */
const SRC = resolve(process.cwd(), "src");
const CARDS = [
  "InsightCard",
  "InsightSurface",
  "InsightCardSkeleton",
  "SummaryCard",
  "ReportCard",
  "ReportCardSkeleton",
  "OwnRankCard",
  "InsightFrame",
  "InsightFrameSkeleton",
];
/** The sales-report screens (the shared view and, R20 §B, its employee period cards). */
const SALES_REPORT_FILES = [
  "components/reports/sales-reports-view.tsx",
  "components/reports/employee-periods-card.tsx",
] as const;
/** Layout-only utilities a caller may give a card (its place in the grid, the gap of its rows). */
const CARD_ALLOWED =
  /^(?:[a-z0-9]+:)*(?:col-span-\S+|row-span-\S+|col-start-\S+|h-full|min-h-\S+|self-\S+|order-\S+|w-full|min-w-0|flex-1|basis-\S+|gap-\S+)$/;
/** A group owns spacing between cards; a caller sets its columns and its inset only. */
const GROUP_FORBIDDEN =
  /^(?:[a-z0-9]+:)*(?:gap-\S+|bg-\S+|border\S*|shadow\S*|rounded\S*|ring\S*|text-\S+|hover:\S+)$/;
/** Expression names a className may pass through (the caller's own `className`). */
const PASS_THROUGH = new Set(["className", "cn", "undefined", "null"]);

function sources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(entry) && !/\.spec\.tsx$/.test(entry)) files.push(path);
    }
  };
  for (const dir of ["app", "components", "config"]) walk(join(SRC, dir));
  return files;
}

/** The text of each `<Name …>` opening tag (balanced braces / quotes). */
function openingTags(raw: string, name: string): string[] {
  // Whole-line `//` comments may hold apostrophes ("the check's …") — drop them first.
  const source = raw.replace(/^\s*\/\/.*$/gm, "");
  const tags: string[] = [];
  const re = new RegExp(`<${name}\\b`, "g");
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + 1;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

/** The card's own `className=` (top level of the tag, not a nested element's). */
function classNameValue(tag: string): string | null {
  let at = -1;
  let level = 0;
  for (let k = 0; k < tag.length; k += 1) {
    if (tag[k] === "{") level += 1;
    else if (tag[k] === "}") level -= 1;
    else if (level === 0 && tag.startsWith("className=", k) && /\s/.test(tag[k - 1])) {
      at = k;
      break;
    }
  }
  if (at < 0) return null;
  let i = tag.indexOf("=", at) + 1;
  if (tag[i] === '"') return tag.slice(i, tag.indexOf('"', i + 1) + 1);
  let depth = 0;
  const start = i;
  for (; i < tag.length; i += 1) {
    if (tag[i] === "{") depth += 1;
    if (tag[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return tag.slice(start, i + 1);
}

function classTokens(value: string): { tokens: string[]; names: string[] } {
  const literals = [...value.matchAll(/"([^"]*)"|`([^`]*)`|'([^']*)'/g)];
  const tokens = literals.flatMap((m) => (m[1] ?? m[2] ?? m[3]).split(/\s+/)).filter(Boolean);
  const rest = value.replace(/"[^"]*"|`[^`]*`|'[^']*'/g, " ");
  const names = [...rest.matchAll(/\b[A-Za-z_]\w*\b/g)].map((m) => m[0]);
  return { tokens, names };
}

describe("report-card consumers never style a card locally", () => {
  const files = sources();

  it("finds the consumers (sanity: the scan sees the converged screens)", () => {
    const consumers = files.filter((path) =>
      new RegExp(`<(${CARDS.join("|")})\\b`).test(readFileSync(path, "utf8")),
    );
    expect(consumers.length).toBeGreaterThan(25);
  });

  it("a card's className only places it in its grid", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const file = relative(SRC, path).replace(/\\/g, "/");
      // The shared implementations themselves compose the surface.
      if (file === "components/shared/insight-card.tsx") continue;
      for (const name of CARDS) {
        for (const tag of openingTags(source, name)) {
          const value = classNameValue(tag);
          if (!value) continue;
          const { tokens, names } = classTokens(value);
          const bad = [
            ...tokens.filter((token) => !CARD_ALLOWED.test(token)),
            ...names.filter((n) => !PASS_THROUGH.has(n)),
          ];
          if (bad.length) offenders.push(`${file} <${name}>: ${bad.join(" ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a card group never sets its own gap, surface or text colour", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const file = relative(SRC, path).replace(/\\/g, "/");
      for (const tag of openingTags(source, "InsightGroup")) {
        const value = classNameValue(tag);
        if (!value) continue;
        const bad = classTokens(value).tokens.filter((token) => GROUP_FORBIDDEN.test(token));
        if (bad.length) offenders.push(`${file}: ${bad.join(" ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no second metric-tile implementation exists (KpiCard is retired)", () => {
    expect(existsSync(join(SRC, "components/shared/kpi-card.tsx"))).toBe(false);
    const importers = files.filter((path) =>
      /kpi-card|\bKpiCard\b/.test(readFileSync(path, "utf8")),
    );
    expect(importers.map((path) => relative(SRC, path))).toEqual([]);
  });

  it("R18 §C: no bespoke summary tile — a headline figure lives only in the shared cards", () => {
    // A figure-sized numeric run (metric / title scale + tabular digits) in one class string is
    // the signature of a hand-built summary tile (e.g. a tinted box with a big count). Only the
    // shared card implementations draw one; document totals are a totals row, not a card.
    const FIGURE_SIZE =
      /^(?:[a-z0-9]+:)*text-(?:metric|metric-lg|ui-title|section-title|page-title|display)$/;
    const NUMERIC = /^(?:[a-z0-9]+:)*(?:num|tabular-nums)$/;
    const ALLOWED = new Set([
      "components/shared/insight-card.tsx",
      "components/reports/report-card.tsx",
      "components/documents/document-totals.tsx",
    ]);
    const offenders: string[] = [];
    for (const path of files) {
      const file = relative(SRC, path).replace(/\\/g, "/");
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(path, "utf8");
      for (const m of source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
        const tokens = (m[1] ?? m[2]).split(/\s+/);
        if (tokens.some((t) => FIGURE_SIZE.test(t)) && tokens.some((t) => NUMERIC.test(t))) {
          offenders.push(`${file}: ${(m[1] ?? m[2]).trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("R18 §C: the card slots (surface, title, figure) are drawn only by the shared cards", () => {
    const OWNERS = new Set([
      "components/shared/insight-card.tsx",
      "components/reports/report-card.tsx",
      "components/agents/summary-card.tsx",
      "app/(shell)/company-partners/_components/partner-login.tsx",
    ]);
    const offenders = files
      .map((path) => relative(SRC, path).replace(/\\/g, "/"))
      .filter((file) => !OWNERS.has(file))
      .filter((file) =>
        /data-slot="insight-(card|value|label|icon)"/.test(readFileSync(join(SRC, file), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  it("R19 §C: every sales-report screen draws its cards at the shared report size", () => {
    // The company and agent sales-report routes are the one shared view (their scopes differ
    // in the API only).
    expect(readFileSync(join(SRC, "app/(shell)/reports/sales/page.tsx"), "utf8")).toMatch(
      /<SalesReportsView source="company" \/>/,
    );
    expect(readFileSync(join(SRC, "app/(shell)/agent/reports/page.tsx"), "utf8")).toMatch(
      /<SalesReportsView source="agent" \/>/,
    );
    const view = SALES_REPORT_FILES.map((file) => readFileSync(join(SRC, file), "utf8")).join("\n");
    const offenders: string[] = [];
    // Every card group is a report group; every shared card a report card (ReportCard and its
    // skeleton always are — checked in report-card-size.spec.tsx).
    for (const tag of openingTags(view, "InsightGroup")) {
      if (!/\ssize="report"/.test(tag)) offenders.push(`InsightGroup without size="report"`);
    }
    for (const name of ["InsightCard", "InsightCardSkeleton", "OwnRankCard", "SummaryCard"]) {
      for (const tag of openingTags(view, name)) {
        if (!/\ssize="report"/.test(tag)) offenders.push(`<${name}> without size="report"`);
      }
    }
    expect(offenders).toEqual([]);
    expect(openingTags(view, "InsightGroup").length).toBeGreaterThanOrEqual(6);
    // The long, repeated lists (one card per team; R20 §B the period boxes of every employee
    // card) are opaque — no blur stack.
    for (const [file, list] of [
      [SALES_REPORT_FILES[0], "data.teams.map"],
      [SALES_REPORT_FILES[1], "periods.map"],
    ]) {
      const source = readFileSync(join(SRC, file), "utf8");
      const at = source.indexOf(`{${list}(`);
      expect(at, list).toBeGreaterThan(-1);
      const group = source.slice(source.lastIndexOf("<InsightGroup", at), at);
      expect(group, list).toMatch(/\ssurface="opaque"/);
    }
    // ReportCard always renders the report size, and only the sales reports use it.
    const reportCard = readFileSync(join(SRC, "components/reports/report-card.tsx"), "utf8");
    expect(openingTags(reportCard, "InsightSurface").join(" ")).toMatch(/\ssize="report"/);
    const reportCardUsers = files
      .filter((path) => /<ReportCard(Skeleton)?\b/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).replace(/\\/g, "/"))
      .sort();
    expect(reportCardUsers).toEqual([...SALES_REPORT_FILES].sort());
  });

  it("R20 §B: employee performance = one shared outer card per employee with five period boxes", () => {
    const view = readFileSync(join(SRC, SALES_REPORT_FILES[0]), "utf8");
    const periods = readFileSync(join(SRC, SALES_REPORT_FILES[1]), "utf8");
    // The Employees and My performance tabs render the period cards (one request per page).
    expect(view).toMatch(
      /current === "employees" \|\| current === "own" \? \(\s*<EmployeePeriodsTab source=\{source\} \/>/,
    );
    expect(view).toMatch(/salesReportsService\.employeePeriods\(source,/);
    // Every employee row is a PeriodsCard in the person's identity; the separate rows too.
    const cards = openingTags(view, "PeriodsCard");
    expect(cards.length).toBe(3);
    for (const tag of cards) {
      expect(tag).toMatch(/\sidentity=\{METRIC_IDENTITY\.(personSales|unassigned|agentSales)\}/);
      expect(tag).not.toMatch(/\sclassName=/);
    }
    // The outer card is the shared InsightFrame; the boxes take the period identities and icons.
    expect(openingTags(periods, "InsightFrame")).toHaveLength(1);
    const box = openingTags(periods, "ReportCard").join(" ");
    expect(box).toMatch(/\sidentity=\{PERIOD_IDENTITY\[entry\.period\]\}/);
    expect(box).toMatch(/\sicon=\{PERIOD_ICON\[entry\.period\]\}/);
    // Phones never get five in a row: one column at the base, five only from a 66rem frame.
    const grid = periods.match(/PERIOD_BOX_GRID =\s*"([^"]+)"/)?.[1].split(/\s+/) ?? [];
    expect(grid[0]).toBe("grid-cols-1");
    // Phones (a card from 19rem inside): two boxes per row, the fifth spanning its row.
    expect(grid).toEqual(
      expect.arrayContaining([
        "@min-[19rem]:grid-cols-2",
        "@min-[19rem]:[&>:last-child]:col-span-2",
      ]),
    );
    expect(grid.filter((token) => /grid-cols-5$/.test(token))).toEqual([
      "@min-[66rem]:grid-cols-5",
    ]);
    expect(grid.every((token) => token === "grid-cols-1" || token.startsWith("@"))).toBe(true);
    // The frame slot is drawn only by the shared component and styled only by the recipe block.
    const owners = files
      .filter((path) => /data-slot="insight-frame/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).replace(/\\/g, "/"));
    expect(owners).toEqual(["components/shared/insight-card.tsx"]);
    for (const name of ["InsightFrame", "InsightFrameSkeleton"]) {
      const users = files
        .filter((path) => new RegExp(`<${name}\\b`).test(readFileSync(path, "utf8")))
        .map((path) => relative(SRC, path).replace(/\\/g, "/"));
      expect(users, name).toEqual([SALES_REPORT_FILES[1]]);
    }
  });

  it("R19 §C2: every sales-report card carries its colour identity from the one mapping", () => {
    const view = SALES_REPORT_FILES.map((file) => readFileSync(join(SRC, file), "utf8")).join("\n");
    const offenders: string[] = [];
    for (const name of ["ReportCard", "OwnRankCard", "InsightCard"]) {
      for (const tag of openingTags(view, name)) {
        if (
          !/\sidentity=\{(PERIOD_IDENTITY|METRIC_IDENTITY|currencyIdentity|identity)\b/.test(tag)
        ) {
          offenders.push(`<${name}> without an identity from report-identity.ts`);
        }
        // An identity replaces the tone — a card never sets both.
        if (/\stone=/.test(tag)) offenders.push(`<${name}> with a tone`);
      }
    }
    expect(offenders).toEqual([]);
    expect(openingTags(view, "ReportCard").length).toBeGreaterThanOrEqual(4);
  });

  it("R19 §C2: identities, icon motion and split currency stay on the sales-report screens", () => {
    const ALLOWED = new Set([
      "components/shared/insight-card.tsx",
      "components/shared/money-value.tsx",
      "components/reports/report-card.tsx",
      "components/reports/own-rank-card.tsx",
      ...SALES_REPORT_FILES,
    ]);
    const offenders: string[] = [];
    for (const path of files) {
      const file = relative(SRC, path).replace(/\\/g, "/");
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(path, "utf8");
      if (/data-identity|data-motion|report-identity/.test(source)) offenders.push(file);
      for (const name of [...CARDS, "InsightIcon", "MoneyValue"]) {
        for (const tag of openingTags(source, name)) {
          if (/\s(identity|iconMotion|motion|currencyClassName)=/.test(tag)) {
            offenders.push(`${file} <${name}>`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("R19 §C: the report size never leaks to other screens", () => {
    // Dashboards, statements, portals and record-grid status cards keep their own size.
    const ALLOWED = new Set([
      "components/shared/insight-card.tsx",
      "components/reports/report-card.tsx",
      "components/reports/own-rank-card.tsx",
      ...SALES_REPORT_FILES,
    ]);
    const offenders: string[] = [];
    for (const path of files) {
      const file = relative(SRC, path).replace(/\\/g, "/");
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(path, "utf8");
      for (const name of [...CARDS, "InsightGroup", "InsightIcon"]) {
        for (const tag of openingTags(source, name)) {
          if (/\ssize="report"|\ssurface="opaque"/.test(tag)) offenders.push(`${file} <${name}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only the one recipe block (and print) styles the report-card slot", () => {
    const recipes = readFileSync(join(SRC, "theme/recipes.css"), "utf8").replace(/\r\n/g, "\n");
    const start = recipes.indexOf("/* ── Report cards");
    const end = recipes.indexOf("/* Round 6 (§12.13): a dashboard panel's header icon");
    const outside = (recipes.slice(0, start) + recipes.slice(end)).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(outside).not.toMatch(/data-slot="insight-(card|icon|value|go|action)"/);
    for (const css of ["app/globals.css", "theme/tokens.css"]) {
      expect(readFileSync(join(SRC, css), "utf8")).not.toMatch(/\[data-slot="insight-card"\]/);
    }
  });
});
