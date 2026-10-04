// R9 correction — fresh evidence: blue-only controls, every lead-distribution state, flat status cards,
// hover / focus / selected, reduced motion. Local stack: web :4601, API :4605, DB oms_r7_final.
import { chromium, login, PERSONAS, BASE, mkdirSync } from "./lib.mjs";

const OUT = "D:/Systems/OMS-r9-brand-grid/specs/round9-brand-grid/evidence/correction";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const hueOf = (m) => {
  if (!m || m.length < 3) return null;
  const [r, g, b] = [m[0] / 255, m[1] / 255, m[2] / 255];
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  if (mx - mn < 0.04) return null;
  const d = mx - mn;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
};

const b = await chromium.launch();

// ---------- 1. blue-only controls (toolbars, forms, dialogs) ----------
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.admin);
  const probe = () =>
    page.evaluate(() => {
      const sel =
        '[data-select-trigger]:not([data-variant="ghost"]), [data-button][data-variant="field"], [data-button][data-variant="menu"], [data-filter-trigger]';
      const toRgb = (css) => {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const x = c.getContext("2d");
        x.fillStyle = "#000";
        x.fillStyle = css;
        x.fillRect(0, 0, 1, 1);
        const d = x.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      return [...document.querySelectorAll(sel)]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({
          tone: e.getAttribute("data-toolbar-tone"),
          bg: toRgb(getComputedStyle(e).backgroundColor),
          fg: toRgb(getComputedStyle(e).color),
          x: Math.round(e.getBoundingClientRect().x),
        }));
    });
  for (const [name, path] of [
    ["toolbar-store-orders", "/store-orders"],
    ["toolbar-shipping", "/shipping"],
    ["report-filters", "/reports/finance"],
    ["form-new-order", "/sales/orders/new"],
    ["toolbar-leads", "/crm/leads"],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    const rows = await probe();
    const hues = [...new Set(rows.map((r) => hueOf(r.bg)).filter((h) => h !== null))];
    check(
      `${name}: every selector control is in the blue family (hue 200–250), no teal`,
      rows.length > 0 && hues.every((h) => h >= 205 && h <= 250),
      `hues ${hues.join(",")} · ${rows.length} controls`,
    );
    check(
      `${name}: white labels on every control`,
      rows.every((r) => r.fg.every((v) => v >= 245)),
      "",
    );
    await page.screenshot({ path: `${OUT}/${name}-ar-light.png` });
    if (name === "toolbar-store-orders") {
      // Tone n is the n-th control in logical order: deeper = lower luminance, strictly lighter with n.
      const lum = (m) => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
      const byTone = {};
      for (const r of rows.filter((x) => x.tone)) byTone[r.tone] ??= lum(r.bg);
      const seq = Object.keys(byTone)
        .sort()
        .map((k) => byTone[k]);
      check(
        "toolbar ramp: tone 1 deepest → tone 5 lightest (one blue family)",
        seq.length >= 4 && seq.every((v, i) => i === 0 || v > seq[i - 1]),
        seq.map((v) => v.toFixed(0)).join(" < "),
      );
      const toned = rows.filter((r) => r.tone === "1" || r.tone === "2");
      const t1 = toned.find((r) => r.tone === "1"),
        t2 = toned.find((r) => r.tone === "2");
      check(
        "Arabic: tone 1 sits to the RIGHT of tone 2 (deep first from the right edge)",
        Boolean(t1 && t2 && t1.x > t2.x),
        `x ${t1?.x} > ${t2?.x}`,
      );
    }
  }
  await page.goto(`${BASE}/settings/users`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  const add = page.getByRole("button", { name: /(مستخدم جديد|New user)/i }).first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(1200);
    const rows = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[role="dialog"] [data-select-trigger], [role="dialog"] [data-button][data-variant="field"]',
        ),
      ].map((e) => getComputedStyle(e).backgroundColor),
    );
    check(
      "dialog form selects: one default blue shade",
      new Set(rows).size === 1 && rows.length > 0,
      `${rows.length} selects, ${new Set(rows).size} shade(s)`,
    );
    await page.screenshot({ path: `${OUT}/form-dialog-ar-light.png` });
  }
  await ctx.close();
}
{
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en",
    colorScheme: "dark",
  });
  const page = await login(ctx, PERSONAS.admin);
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/toolbar-store-orders-en-dark.png` });
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.agentAdmin);
  await page.goto(`${BASE}/agent/orders`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/agent-orders-toolbar-ar-light.png` });
  await ctx.close();
}

// ---------- 2. lead distribution: every state ----------
const future = new Date(Date.now() + 20 * 3600e3).toISOString();
const base = {
  eligible: [{ id: "u1", fullName: "Sales A", email: "a@oms.local" }],
  eligibleCount: 1,
  pendingEligibleCount: 7,
  held: { count: 0, batches: [] },
  team: null,
  excluded: [],
};
const policy = (mode, extra = {}) => ({
  id: "p1",
  mode,
  isActive: mode === "CONTINUOUS" || mode === "TIME_LIMITED",
  startedAt: new Date().toISOString(),
  expiresAt: null,
  remainingMs: null,
  teamId: null,
  ...extra,
});
const STATES = {
  continuous: { ...base, status: "CONTINUOUS", policy: policy("CONTINUOUS") },
  timeLimited: {
    ...base,
    status: "TIME_LIMITED",
    policy: policy("TIME_LIMITED", { expiresAt: future, remainingMs: 20 * 3600e3 }),
  },
  manual: { ...base, status: "MANUAL", policy: policy("MANUAL") },
  paused: { ...base, status: "PAUSED", policy: policy("PAUSED") },
  blocked: {
    ...base,
    eligible: [],
    eligibleCount: 0,
    status: "CONTINUOUS",
    policy: policy("CONTINUOUS"),
    failureCode: "NO_ELIGIBLE_EMPLOYEES",
    failureReason: "No eligible sales employees.",
  },
  blockedTimeLimited: {
    ...base,
    status: "TIME_LIMITED",
    policy: policy("TIME_LIMITED", { expiresAt: future, remainingMs: 1e7 }),
    failureCode: "ASSIGN_FAILED",
    failureReason: "Assignment failed.",
  },
  backlogOnly: {
    ...base,
    pendingEligibleCount: 250,
    status: "CONTINUOUS",
    policy: policy("CONTINUOUS"),
  },
};
const seen = {};
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.admin);
  // the REAL server-confirmed state first (no interception)
  await page.goto(`${BASE}/crm/leads`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  const real = page.getByTestId("lead-distribution-control");
  if (await real.count()) {
    seen.real = await real.getAttribute("data-distribution-state");
    await page.screenshot({ path: `${OUT}/distribution-real-server-state.png` });
    check(
      "the real server state renders a state-coloured control",
      Boolean(seen.real),
      seen.real ?? "",
    );
  } else check("lead-distribution control present for the manager", false, "not rendered");
  await page.unroute("**/leads/distribution").catch(() => {});
  for (const [name, snapshot] of [
    ...Object.entries(STATES),
    ["unavailable", null],
    ["loading", "slow"],
  ]) {
    await page.route("**/leads/distribution", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (snapshot === null)
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "boom" }),
        });
      if (snapshot === "slow") {
        await new Promise((r) => setTimeout(r, 6000));
        return route.continue();
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot),
      });
    });
    await page.goto(`${BASE}/crm/leads`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(name === "loading" ? 1800 : 2600);
    const btn = page.getByTestId("lead-distribution-control");
    if (!(await btn.count())) {
      check(`state ${name}: control rendered`, false, "missing");
      await page.unroute("**/leads/distribution");
      continue;
    }
    const info = await btn.evaluate((el) => ({
      state: el.getAttribute("data-distribution-state"),
      bg: getComputedStyle(el).backgroundColor,
      fg: getComputedStyle(el).color,
      border: getComputedStyle(el).borderTopStyle,
      text: el.textContent.replace(/\s+/g, " ").trim(),
    }));
    seen[name] = info;
    await btn.screenshot({ path: `${OUT}/distribution-${name}.png` });
    await page.unroute("**/leads/distribution");
  }
  const solid = ["continuous", "timeLimited", "manual", "paused", "blocked"];
  const colours = solid.map((n) => seen[n]?.bg);
  check(
    "the five solid states each have their OWN colour",
    new Set(colours).size === 5 && colours.every(Boolean),
    colours.join(" | "),
  );
  check(
    "each state sets its own data-distribution-state",
    solid.every((n) => seen[n]?.state === n),
    solid.map((n) => `${n}=${seen[n]?.state}`).join(" "),
  );
  check(
    "a failure beats the mode: an active 24-hour mode with a failure shows BLOCKED",
    seen.blockedTimeLimited?.state === "blocked",
    seen.blockedTimeLimited?.state ?? "",
  );
  check(
    "the blocked control still names the mode in text",
    /(Auto|تلقائي)/i.test(seen.blocked?.text ?? "") || /مستمر|دوري/.test(seen.blocked?.text ?? ""),
    seen.blocked?.text ?? "",
  );
  check(
    "a backlog alone (250 pending) is NOT blocked",
    seen.backlogOnly?.state === "continuous",
    `${seen.backlogOnly?.state} · ${seen.backlogOnly?.text}`,
  );
  check(
    "unavailable (status unreadable) = dashed outline, distinct from all five",
    seen.unavailable?.state === "unavailable" &&
      seen.unavailable?.border === "dashed" &&
      !colours.includes(seen.unavailable?.bg),
    `${seen.unavailable?.state}/${seen.unavailable?.border}`,
  );
  check(
    "loading is its own quiet state",
    seen.loading?.state === "loading",
    seen.loading?.state ?? "",
  );
  await ctx.close();
}

// ---------- 3. flat status cards: Leads, Orders, Invoices; hover / focus / selected ----------
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.admin);
  for (const [name, path] of [
    ["leads", "/crm/leads"],
    ["orders", "/store-orders"],
    ["invoices", "/sales/invoices"],
    ["shipping", "/shipping"],
    ["customers", "/sales/customers"],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1400);
    await page.locator('[data-view-toggle] [data-view="grid"]').first().click();
    await page.waitForTimeout(900);
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll("[data-record-grid] [data-record-card]")].map((c) => ({
        tone: c.getAttribute("data-tone"),
        image: getComputedStyle(c).backgroundImage,
        radius: getComputedStyle(c).borderTopLeftRadius,
        badges: [...c.querySelectorAll('[data-slot="badge"]')]
          .map((x) => x.textContent.trim())
          .slice(0, 3),
      })),
    );
    const tones = [...new Set(cards.map((c) => c.tone))];
    check(
      `${name}: no card has a background gradient`,
      cards.length > 0 && cards.every((c) => c.image === "none"),
      `${cards.length} cards`,
    );
    check(
      `${name}: one consistent radius`,
      new Set(cards.map((c) => c.radius)).size === 1,
      cards[0]?.radius ?? "",
    );
    check(
      `${name}: every card carries a readable status badge`,
      cards.every((c) => c.badges.length > 0),
      "",
    );
    console.log(`      ${name} tones present: ${tones.join(", ")}`);
    if (name === "orders")
      check(
        `${name}: cards show different real statuses (${tones.length} tones)`,
        tones.length >= 3,
        tones.join(","),
      );
    if (name === "leads") {
      // the default list is the newest (all "not contacted"): walk the real status filters
      const union = new Set(tones);
      const chooseFilter = async (idx, option) => {
        await page.locator("[data-filter-trigger]").nth(idx).click();
        await page.waitForTimeout(400);
        await page.getByRole("option", { name: option, exact: true }).click();
        await page.waitForTimeout(1500);
      };
      const tonesNow = () =>
        page.evaluate(() => [
          ...new Set(
            [...document.querySelectorAll("[data-record-grid] [data-record-card]")].map((c) =>
              c.getAttribute("data-tone"),
            ),
          ),
        ]);
      const passes = [
        ["converted", 0, "محوّلة"],
        ["closed", 0, "مغلقة / مؤرشفة"],
      ];
      for (const [label, idx, option] of passes) {
        await chooseFilter(idx, option);
        const t2 = await tonesNow();
        t2.forEach((x) => union.add(x));
        console.log(`      leads (${label}) tones: ${t2.join(", ")}`);
        await page.screenshot({ path: `${OUT}/cards-leads-${label}-grid.png` });
      }
      await chooseFilter(0, "نشطة");
      for (const outcome of ["مهتم", "تم الرد", "سيتواصل لاحقًا", "لا يرد", "غير مهتم"]) {
        await chooseFilter(1, outcome);
        const t3 = await tonesNow();
        console.log(
          `      leads (active + outcome "${outcome}") tones: ${t3.join(", ") || "(none)"}`,
        );
        if (t3.includes("warning")) {
          t3.forEach((x) => union.add(x));
          await page.screenshot({ path: `${OUT}/cards-leads-following-grid.png` });
          break;
        }
      }
      check(
        `leads: real statuses give different card colours (${[...union].join(", ")})`,
        union.size >= 3,
        [...union].join(","),
      );
    }
    await page.screenshot({ path: `${OUT}/cards-${name}-grid.png` });
    if (name === "orders") {
      const card = page.locator("[data-record-grid] [data-record-card]").nth(1);
      const st = () =>
        card.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            bg: cs.backgroundColor,
            border: cs.borderTopColor,
            shadow: cs.boxShadow,
            transform: cs.transform,
            outline: cs.outlineStyle + " " + cs.outlineWidth,
            rect: [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight].join(","),
          };
        });
      const rest = await st();
      await card.screenshot({ path: `${OUT}/card-default.png` });
      await card.hover();
      await page.waitForTimeout(300);
      const hover = await st();
      await card.screenshot({ path: `${OUT}/card-hover.png` });
      check(
        "hover: the surface tint and the hairline change (no movement)",
        hover.bg !== rest.bg && hover.border !== rest.border && hover.transform === "none",
        `${rest.bg} → ${hover.bg}`,
      );
      check("hover: no resize or reflow", hover.rect === rest.rect, `${rest.rect} / ${hover.rect}`);
      await page.mouse.move(3, 3);
      await card.locator("[data-record-link]").focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(250);
      const focus = await st();
      const bb = await card.boundingBox();
      await page.screenshot({
        path: `${OUT}/card-focus.png`,
        clip: {
          x: Math.max(0, bb.x - 10),
          y: Math.max(0, bb.y - 10),
          width: bb.width + 20,
          height: bb.height + 20,
        },
      });
      check(
        "keyboard focus: a 2px ring around the whole card",
        /solid 2px/.test(focus.outline),
        focus.outline,
      );
      await card.locator('[role="checkbox"]').click();
      await page.waitForTimeout(350);
      await page.mouse.move(3, 3);
      await page.waitForTimeout(250);
      const selected = await st();
      await card.screenshot({ path: `${OUT}/card-selected.png` });
      await card.hover();
      await page.waitForTimeout(300);
      const selectedHover = await st();
      await card.screenshot({ path: `${OUT}/card-selected-hover.png` });
      check(
        "selected is distinguishable from hovered (ring + different tint)",
        selected.shadow !== hover.shadow &&
          selected.bg !== hover.bg &&
          selected.border !== hover.border,
        `${selected.bg} vs ${hover.bg}`,
      );
      check(
        "selected + hover stays selected (ring kept)",
        selectedHover.shadow === selected.shadow,
        "",
      );
      await page.screenshot({ path: `${OUT}/cards-orders-with-selection-and-bulk-strip.png` });
    }
  }
  // reduced motion: no transition on a card
  const rm = await b.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ar",
    reducedMotion: "reduce",
  });
  const p2 = await login(rm, PERSONAS.admin);
  await p2.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await p2.waitForLoadState("networkidle").catch(() => {});
  await p2.waitForTimeout(1200);
  await p2.locator('[data-view-toggle] [data-view="grid"]').first().click();
  await p2.waitForTimeout(700);
  const dur = await p2
    .locator("[data-record-grid] [data-record-card]")
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  check(
    "reduced motion: card transitions are off (≤ 0.01 ms)",
    dur.split(", ").every((d) => parseFloat(d) <= 0.00001),
    dur,
  );
  await rm.close();
  await ctx.close();
}
// agent screens
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.agentAdmin);
  for (const [name, path] of [
    ["agent-orders", "/agent/orders"],
    ["agent-leads", "/agent/leads"],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1400);
    await page.locator('[data-view-toggle] [data-view="grid"]').first().click();
    await page.waitForTimeout(900);
    const flat = await page.evaluate(() =>
      [...document.querySelectorAll("[data-record-grid] [data-record-card]")].every(
        (c) => getComputedStyle(c).backgroundImage === "none",
      ),
    );
    check(`${name}: flat cards (no gradient)`, flat, "");
    await page.screenshot({ path: `${OUT}/cards-${name}-grid.png` });
  }
  await ctx.close();
}
await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
