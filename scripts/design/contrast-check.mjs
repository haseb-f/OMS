#!/usr/bin/env node
/**
 * Token contrast check (milestone enterprise-ui-overhaul).
 *
 *   node scripts/design/contrast-check.mjs
 *
 * Parses the light (:root) and dark (.dark) color tokens from
 * apps/web/src/app/globals.css, resolves var()/color-mix(in oklab, …) chains,
 * composites translucent colors over their surface, and checks the WCAG pairs
 * the design system promises (design-system.md §3). Exits 1 on any failure.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(resolve(ROOT, "apps/web/src/app/globals.css"), "utf8");

function block(selector) {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`block ${selector} not found`);
  let depth = 0;
  let j = css.indexOf("{", i);
  const start = j + 1;
  for (; j < css.length; j += 1) {
    if (css[j] === "{") depth += 1;
    else if (css[j] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = css.slice(start, j).replace(/\/\*[\s\S]*?\*\//g, "");
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    // Prettier wraps long color-mix() values over several lines — flatten them.
    vars[m[1]] = m[2].replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  }
  return vars;
}

// ---- color math (sRGB / OKLab / OKLCH), alpha-aware -------------------------
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
/** Color = { lab: [L,a,b], alpha } */
function parse(value, vars, seen = new Set()) {
  // Percentage tokens inside color-mix() (e.g. var(--insight-tint-top)).
  value = value
    .trim()
    .replace(/var\(--([\w-]+)\)/g, (m, name) =>
      /^[\d.]+%$/.test(vars[name] ?? "") ? vars[name] : m,
    );
  const v = value.match(/^var\(--([\w-]+)\)$/);
  if (v) {
    if (seen.has(v[1])) throw new Error(`cycle ${v[1]}`);
    seen.add(v[1]);
    if (!(v[1] in vars)) throw new Error(`unknown var --${v[1]}`);
    return parse(vars[v[1]], vars, seen);
  }
  if (value === "white") return { lab: linearToOklab([1, 1, 1]), alpha: 1 };
  if (value === "black") return { lab: [0, 0, 0], alpha: 1 };
  if (value === "transparent") return { lab: [0, 0, 0], alpha: 0 };
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return {
      lab: linearToOklab([(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => lin(c / 255))),
      alpha: 1,
    };
  }
  const ok = value.match(
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/,
  );
  if (ok) {
    const L = Number(ok[1]) / (ok[2] ? 100 : 1);
    const C = Number(ok[3]);
    const h = (Number(ok[4]) * Math.PI) / 180;
    const alpha = ok[5] == null ? 1 : Number(ok[5]) / (ok[6] ? 100 : 1);
    return { lab: [L, C * Math.cos(h), C * Math.sin(h)], alpha };
  }
  const hsl = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  if (hsl) {
    const [h, sat, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { lab: linearToOklab([f(0), f(8), f(4)].map(lin)), alpha: 1 };
  }
  const mix = value.match(/^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/);
  if (mix) {
    const a = parse(mix[1], vars, new Set(seen));
    const b = parse(mix[3], vars, new Set(seen));
    const p = Number(mix[2]) / 100;
    // premultiplied interpolation, per CSS Color 5
    const alpha = a.alpha * p + b.alpha * (1 - p);
    const lab =
      alpha === 0
        ? [0, 0, 0]
        : a.lab.map((x, k) => (x * a.alpha * p + b.lab[k] * b.alpha * (1 - p)) / alpha);
    return { lab, alpha };
  }
  throw new Error(`unparsed color: ${value}`);
}
function over(fg, bg) {
  if (fg.alpha >= 1) return fg;
  const f = oklabToLinear(fg.lab).map((c) => unlin(Math.min(1, Math.max(0, c))));
  const b = oklabToLinear(bg.lab).map((c) => unlin(Math.min(1, Math.max(0, c))));
  const mixed = f.map((c, k) => c * fg.alpha + b[k] * (1 - fg.alpha));
  return { lab: linearToOklab(mixed.map(lin)), alpha: 1 };
}
function luminance(color) {
  const [r, g, b] = oklabToLinear(color.lab).map((c) => Math.min(1, Math.max(0, c)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fgExpr, bgExpr, vars, baseExpr = "var(--background)") {
  const base = parse(baseExpr, vars);
  const bg = over(parse(bgExpr, vars), base);
  const fg = over(parse(fgExpr, vars), bg);
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [label, fg, bg, min, base?]
const TEXT = 4.5;
const UI = 3;
const PAIRS = [
  ["body text", "var(--foreground)", "var(--background)", TEXT],
  ["body text on surface", "var(--foreground)", "var(--card)", TEXT],
  ["muted text on surface", "var(--muted-foreground)", "var(--card)", TEXT],
  ["muted text on muted", "var(--muted-foreground)", "var(--muted)", TEXT],
  ["muted text on canvas", "var(--muted-foreground)", "var(--background)", TEXT],
  ["placeholder on input", "var(--placeholder)", "var(--card)", TEXT],
  ["primary button", "var(--primary-foreground)", "var(--primary)", TEXT],
  ["primary as text/link", "var(--primary)", "var(--card)", TEXT],
  ["primary text on primary-soft", "var(--primary)", "var(--primary-soft)", TEXT, "var(--card)"],
  ["secondary button", "var(--secondary-foreground)", "var(--secondary)", TEXT, "var(--card)"],
  ["destructive button", "var(--destructive-foreground)", "var(--destructive)", TEXT],
  ["destructive text", "var(--destructive-text)", "var(--card)", TEXT],
  ["success button", "var(--success-foreground)", "var(--success)", TEXT],
  ["warning button", "var(--warning-foreground)", "var(--warning)", TEXT],
  ["info button", "var(--info-foreground)", "var(--info)", TEXT],
  ...["success", "warning", "info", "destructive", "neutral"].map((t) => [
    `${t} badge`,
    `var(--${t}-soft-foreground)`,
    `var(--${t}-soft)`,
    TEXT,
    "var(--card)",
  ]),
  ...["success", "warning", "info", "destructive"].map((t) => [
    `${t} badge border`,
    `var(--${t}-border)`,
    "var(--card)",
    1.3,
  ]),
  ...["revenue", "expense", "profit", "loss"].map((t) => [
    `report ${t} on soft`,
    `var(--report-${t})`,
    `var(--report-${t}-soft)`,
    TEXT,
    "var(--card)",
  ]),
  // Round 6 metric tiles (§12.13): text on the strongest (top) tone tint,
  // the value on it, and the icon on its chip, per theme token.
  ...["info", "success", "warning", "destructive", "revenue", "expense", "profit", "loss"].flatMap(
    (t) => [
      [
        `tile ${t} label on tint`,
        "var(--muted-foreground)",
        `color-mix(in oklab, var(--insight-${t}) var(--insight-tint-top), var(--card))`,
        TEXT,
      ],
      [
        `tile ${t} value on tint`,
        "var(--foreground)",
        `color-mix(in oklab, var(--insight-${t}) var(--insight-tint-top), var(--card))`,
        TEXT,
      ],
      [
        `tile ${t} icon on chip`,
        `var(--insight-${t})`,
        `color-mix(in oklab, var(--insight-${t}) var(--insight-icon-fill), var(--card))`,
        UI,
      ],
    ],
  ),
  // Round 7 panel headers: the title and muted description on the strongest
  // header tint of each tone.
  ...["info", "success", "warning", "destructive"].flatMap((t) => [
    [
      `panel ${t} title on header tint`,
      "var(--foreground)",
      `color-mix(in oklab, var(--insight-${t}) var(--panel-header-tint), var(--card))`,
      TEXT,
    ],
    [
      `panel ${t} description on header tint`,
      "var(--muted-foreground)",
      `color-mix(in oklab, var(--insight-${t}) var(--panel-header-tint), var(--card))`,
      TEXT,
    ],
  ]),
  [
    "tile destructive value on tint",
    "var(--destructive-text)",
    "color-mix(in oklab, var(--insight-destructive) var(--insight-tint-top), var(--card))",
    UI,
  ],
  // Round 9 (§12.18): brand button roles — text on every fill the role can take.
  ["secondary button text", "var(--btn-secondary-foreground)", "var(--btn-secondary)", TEXT, "var(--card)"],
  ["secondary button text (hover)", "var(--btn-secondary-foreground)", "var(--btn-secondary-hover)", TEXT, "var(--card)"],
  ["outline button text", "var(--btn-outline-foreground)", "var(--card)", TEXT],
  ["outline button text (hover)", "var(--btn-outline-foreground)", "var(--btn-soft-hover)", TEXT, "var(--card)"],
  ["outline button text (pressed)", "var(--btn-outline-foreground)", "var(--btn-soft-pressed)", TEXT, "var(--card)"],
  ["ghost button text (hover)", "var(--foreground)", "var(--btn-soft-hover)", TEXT, "var(--card)"],
  ["ghost button text (pressed)", "var(--foreground)", "var(--btn-soft-pressed)", TEXT, "var(--card)"],
  ["muted icon on soft hover", "var(--muted-foreground)", "var(--btn-soft-hover)", UI, "var(--card)"],
  ["outline hairline on card", "var(--btn-outline-border)", "var(--card)", 1.25],
  // Round 9 (§12.19): record cards — body text, muted labels and the reference on the strongest
  // tone wash (9 %, top of the gradient) and on the selected tint.
  ...["success", "warning", "destructive", "info", "neutral"].flatMap((t) => [
    [`record card ${t}: text on wash`, "var(--foreground)", `color-mix(in oklab, var(--insight-${t}) 14%, var(--card))`, TEXT, "var(--card)"],
    [`record card ${t}: muted label on wash`, "var(--muted-foreground)", `color-mix(in oklab, var(--insight-${t}) 14%, var(--card))`, TEXT, "var(--card)"],
  ]),
  ["record card selected: text", "var(--foreground)", "color-mix(in oklab, var(--focus-ring) 15%, var(--card))", TEXT, "var(--card)"],
  ["record card selected: muted label", "var(--muted-foreground)", "color-mix(in oklab, var(--focus-ring) 15%, var(--card))", TEXT, "var(--card)"],
  ["record card selection ring on card", "var(--focus-ring)", "var(--card)", UI],
  // Round 9 (§12.20): lead-distribution state surfaces — label text on rest and hover.
  ...[
    ["continuous", "var(--success)", "var(--success-foreground)", "color-mix(in oklab, var(--success) 86%, black)"],
    ["time-limited", "var(--state-scheduled)", "#ffffff", "var(--state-scheduled-hover)"],
    ["manual", "var(--state-manual)", "#ffffff", "var(--state-manual-hover)"],
    ["paused", "var(--warning)", "var(--warning-foreground)", "color-mix(in oklab, var(--warning) 88%, black)"],
    ["blocked", "var(--destructive)", "var(--destructive-foreground)", "color-mix(in oklab, var(--destructive) 86%, black)"],
  ].flatMap(([name, bg, fg, hover]) => [
    [`distribution ${name}: label`, fg, bg, TEXT, "var(--card)"],
    [`distribution ${name}: label (hover)`, fg, hover, TEXT, "var(--card)"],
  ]),
  // design-system §12.10: the hairline ring stays light; the field's bottom
  // edge (--control-edge) carries the 3:1 boundary.
  ["control boundary (field edge)", "var(--control-edge)", "var(--card)", UI],
  ["focus ring on surface", "var(--focus-ring)", "var(--card)", UI],
  ["focus ring on canvas", "var(--focus-ring)", "var(--background)", UI],
  ["sidebar text", "var(--sidebar-foreground)", "var(--sidebar)", TEXT],
  ["sidebar muted text", "var(--sidebar-muted-foreground)", "var(--sidebar)", TEXT],
  ["sidebar active", "var(--sidebar-primary)", "var(--sidebar-active)", TEXT, "var(--sidebar)"],
  [
    "table header text",
    "var(--table-header-foreground)",
    "var(--table-header)",
    TEXT,
    "var(--card)",
  ],
  ["selected row text", "var(--foreground)", "var(--table-row-selected)", TEXT, "var(--card)"],
  ["toast error", "var(--destructive-foreground)", "var(--destructive)", TEXT],
  // usability-financial-reports §5: tinted success / failure toasts.
  ...["success", "destructive"].flatMap((t) => [
    [
      `toast ${t} title`,
      `var(--toast-${t}-title)`,
      `var(--toast-${t}-surface)`,
      TEXT,
      "var(--popover)",
    ],
    [
      `toast ${t} body text`,
      "var(--popover-foreground)",
      `var(--toast-${t}-surface)`,
      TEXT,
      "var(--popover)",
    ],
    [
      `toast ${t} accent edge`,
      `var(--toast-${t}-edge)`,
      `var(--toast-${t}-surface)`,
      UI,
      "var(--popover)",
    ],
    [`toast ${t} ring on canvas`, `var(--toast-${t}-border)`, "var(--background)", 1.3],
  ]),
  // Round 7 selector triggers (design-system §12.14): solid deep navy.
  // Text (value / placeholder / filter label) on every state fill, icons and
  // chevron chip at 3:1, the edge against both the surface and the canvas.
  ...[
    ["rest", "var(--selector)"],
    ["hover", "var(--selector-hover)"],
    ["open/pressed", "var(--selector-active)"],
    ["applied filter", "var(--selector-applied)"],
  ].flatMap(([state, fill]) => [
    [`selector value (${state})`, "var(--selector-foreground)", fill, TEXT, "var(--card)"],
    [`selector placeholder/label (${state})`, "var(--selector-muted)", fill, TEXT, "var(--card)"],
    [`selector icon/chevron (${state})`, "var(--selector-muted)", fill, UI, "var(--card)"],
  ]),
  [
    "selector chevron on chip",
    "var(--selector-foreground)",
    "var(--selector-chip)",
    UI,
    "var(--selector)",
  ],
  ["selector edge on surface", "var(--selector-border)", "var(--card)", UI],
  ["selector edge on canvas", "var(--selector-border)", "var(--background)", UI],
  ["selector open edge", "var(--selector-open-edge)", "var(--selector-active)", UI, "var(--card)"],
  ["sidebar rail on sidebar", "var(--sidebar-rail)", "var(--sidebar)", UI],
  // Round 5 (design-system §12.12): soft surfaces keep every text tone AA.
  ["soft surface text", "var(--foreground)", "var(--surface-soft)", TEXT, "var(--card)"],
  [
    "soft surface muted text",
    "var(--muted-foreground)",
    "var(--surface-soft)",
    TEXT,
    "var(--card)",
  ],
  ["soft surface placeholder", "var(--placeholder)", "var(--surface-soft)", TEXT, "var(--card)"],
  [
    "soft row hover muted text",
    "var(--muted-foreground)",
    "var(--surface-soft-row-hover)",
    TEXT,
    "var(--card)",
  ],
  ["segment selected text", "var(--foreground)", "var(--segment-on)", TEXT, "var(--card)"],
  [
    "segment unselected text",
    "var(--muted-foreground)",
    "var(--segment-track)",
    TEXT,
    "var(--card)",
  ],
  // Round 7 addendum (design-system §12.15): the toolbar tonal sequence.
  // On every step and every state fill: value text, muted label / icon, the
  // applied ring; plus the chevron chip, the step's edge against the card and
  // the open edge on its pressed fill. Neighbouring steps must also stay
  // apart from each other (≥ 1.15:1 fill-to-fill) so the ramp reads as steps.
  ...[1, 2, 3, 4, 5].flatMap((n) => [
    ...[
      ["rest", `var(--toolbar-tone-${n})`],
      ["hover", `var(--toolbar-tone-${n}-hover)`],
      ["open/pressed", `var(--toolbar-tone-${n}-active)`],
    ].flatMap(([state, fill]) => [
      [
        `toolbar tone ${n} value (${state})`,
        `var(--toolbar-tone-${n}-foreground)`,
        fill,
        TEXT,
        "var(--card)",
      ],
      [
        `toolbar tone ${n} label (${state})`,
        `var(--toolbar-tone-${n}-muted)`,
        fill,
        TEXT,
        "var(--card)",
      ],
      [
        `toolbar tone ${n} icon (${state})`,
        `var(--toolbar-tone-${n}-muted)`,
        fill,
        UI,
        "var(--card)",
      ],
      [
        `toolbar tone ${n} applied ring (${state})`,
        `var(--toolbar-tone-${n}-ring)`,
        fill,
        UI,
        "var(--card)",
      ],
    ]),
    [
      `toolbar tone ${n} chevron on chip`,
      `var(--toolbar-tone-${n}-foreground)`,
      `var(--toolbar-tone-${n}-chip)`,
      UI,
      `var(--toolbar-tone-${n})`,
    ],
    [`toolbar tone ${n} edge on surface`, `var(--toolbar-tone-${n}-border)`, "var(--card)", UI],
    [
      `toolbar tone ${n} open edge`,
      `var(--toolbar-tone-${n}-open-edge)`,
      `var(--toolbar-tone-${n}-active)`,
      UI,
      "var(--card)",
    ],
  ]),
  ...[1, 2, 3, 4].map((n) => [
    `toolbar tone ${n} vs ${n + 1} step`,
    `var(--toolbar-tone-${n})`,
    `var(--toolbar-tone-${n + 1})`,
    1.15,
    "var(--card)",
  ]),
];

let failed = 0;
for (const [name, selector] of [
  ["light", ":root"],
  ["dark", ".dark"],
]) {
  const vars = name === "light" ? block(":root") : { ...block(":root"), ...block(".dark") };
  console.log(`\n== ${name} ==`);
  for (const [label, fg, bg, min, base] of PAIRS) {
    let r;
    try {
      r = ratio(fg, bg, vars, base);
    } catch (e) {
      failed += 1;
      console.log(`ERROR ${label}: ${e.message}`);
      continue;
    }
    const ok = r >= min;
    if (!ok) failed += 1;
    console.log(`${ok ? "pass" : "FAIL"}  ${r.toFixed(2).padStart(5)} ≥ ${min}  ${label}`);
  }
}
if (failed) {
  console.log(`\n${failed} pair(s) failed`);
  process.exit(1);
}
console.log("\nall pairs pass");
