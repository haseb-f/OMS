import { chromium, login, PERSONAS, BASE, mkdirSync } from "./lib.mjs";

const OUT = "D:/Systems/OMS-r8-home/specs/round8-home-dashboard/evidence";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

const cardStyle = (loc) =>
  loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    const value = el.querySelector('[data-slot="insight-value"]');
    const icon = el.querySelector('[data-slot="insight-icon"]');
    return {
      tone: el.getAttribute("data-tone"),
      transform: cs.transform,
      border: cs.borderColor,
      bgImage: cs.backgroundImage.slice(0, 40),
      shadow: cs.boxShadow.length,
      cursor: cs.cursor,
      valueSize: value ? getComputedStyle(value).fontSize : null,
      valueColor: value ? getComputedStyle(value).color : null,
      iconBg: icon ? getComputedStyle(icon).backgroundColor : null,
      iconTransform: icon ? getComputedStyle(icon).transform : null,
      outline: cs.outlineStyle,
      // Layout box (ignores paint-only transforms) + the NEXT sibling's painted box: a shift would move it.
      rect: [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight].join(","),
      neighbour: (() => {
        const n = el.nextElementSibling || el.previousElementSibling;
        if (!n) return "none";
        const r = n.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(
          ",",
        );
      })(),
    };
  });

const b = await chromium.launch();
for (const [key, path, lang, scheme] of [
  ["admin", "/dashboard", "ar", "light"],
  ["admin", "/dashboard", "en", "dark"],
  ["agentAdmin", "/agent/dashboard", "ar", "light"],
  ["sales", "/dashboard", "ar", "light"],
]) {
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 },
    locale: lang,
    colorScheme: scheme,
  });
  const page = await login(ctx, PERSONAS[key]);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
  const tag = `${key}-${lang}-${scheme}`;
  await page.screenshot({ path: `${OUT}/dashboard-${tag}-1440.png` });

  const toned = page.locator('[data-slot="insight-card"][data-tone]:not([data-tone="neutral"])');
  const staticToned = page.locator(
    '[data-slot="insight-card"][data-tone]:not([data-tone="neutral"]):not([data-interactive])',
  );
  const interactive = page.locator(
    '[data-slot="insight-card"][data-interactive]:not([data-tone="neutral"])',
  );
  const nToned = await toned.count();
  const nInteractive = await interactive.count();
  check(`${tag}: toned cards present`, nToned > 0, `${nToned} toned (${nInteractive} interactive)`);

  if (nToned > 0) {
    const s = await cardStyle(toned.first());
    check(
      `${tag}: tinted gradient surface (not flat white)`,
      s.bgImage.startsWith("linear-gradient"),
      s.bgImage,
    );
    check(`${tag}: metric value is large`, parseFloat(s.valueSize) >= 26, s.valueSize);
  }
  if ((await staticToned.count()) > 0) {
    const st = await cardStyle(staticToned.first());
    check(
      `${tag}: static summary stays flat (pointer-less)`,
      st.cursor !== "pointer" && st.transform === "none",
      `${st.cursor} ${st.transform}`,
    );
  }
  if (nInteractive > 0) {
    const card = interactive.first();
    const rest = await cardStyle(card);
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.waitForTimeout(400);
    const hover = await cardStyle(card);
    await card.screenshot({ path: `${OUT}/card-hover-${tag}.png` });
    check(`${tag}: interactive card — pointer cursor`, rest.cursor === "pointer", rest.cursor);
    check(
      `${tag}: hover rises, strengthens border, fills icon chip`,
      hover.transform !== rest.transform &&
        hover.border !== rest.border &&
        hover.iconBg !== rest.iconBg,
      `${hover.transform} | ${rest.iconBg} → ${hover.iconBg}`,
    );
    check(
      `${tag}: hover causes no layout shift (own box and neighbour unchanged)`,
      hover.rect === rest.rect && hover.neighbour === rest.neighbour,
      `${rest.rect} / ${rest.neighbour} vs ${hover.rect} / ${hover.neighbour}`,
    );
    check(
      `${tag}: hover leaves the figure's size unchanged`,
      hover.valueSize === rest.valueSize,
      hover.valueSize,
    );
    await page.mouse.move(2, 2);
    await card.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(400);
    const focusStyle = await card.evaluate((el) => ({
      active: document.activeElement === el,
      outline: getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth,
      transform: getComputedStyle(el).transform,
    }));
    const bb = await card.boundingBox();
    await page.screenshot({
      path: `${OUT}/card-focus-${tag}.png`,
      clip: {
        x: Math.max(0, bb.x - 10),
        y: Math.max(0, bb.y - 10),
        width: bb.width + 20,
        height: bb.height + 20,
      },
    });
    check(
      `${tag}: keyboard focus ring + same response`,
      focusStyle.active && /solid/.test(focusStyle.outline),
      JSON.stringify(focusStyle),
    );
    await card.screenshot({ path: `${OUT}/card-default-${tag}.png` }).catch(() => {});
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`${tag}: no horizontal overflow`, overflow <= 0, String(overflow));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ctx.close();
}
// Phones.
for (const [key, path] of [
  ["admin", "/dashboard"],
  ["agentAdmin", "/agent/dashboard"],
]) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar",
    isMobile: true,
  });
  const page = await login(ctx, PERSONAS[key]);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`${key} dashboard at 390px: no horizontal overflow`, overflow <= 0, String(overflow));
  await page.screenshot({ path: `${OUT}/dashboard-${key}-ar-light-390.png` });
  await ctx.close();
}
await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
