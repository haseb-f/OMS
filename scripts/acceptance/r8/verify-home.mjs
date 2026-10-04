// Local review only: needs the demo stack (web :4401, API :4405, DB oms_r7_final) and tmp/r7-final/.r7.env.
import { chromium, login, apiToken, PERSONAS, API, mkdirSync } from "./lib.mjs";

const OUT = "D:/Systems/OMS-r8-home/specs/round8-home-dashboard/evidence";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

const tiles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-slot="launcher-tile"]')].map((a) => ({
      href: new URL(a.href).pathname,
      tone: a.getAttribute("data-tone"),
      size: a.getAttribute("data-size"),
      title: a.querySelector("span.flex-col > span")?.textContent?.trim(),
    })),
  );

const b = await chromium.launch();

// 1 — Home after a normal login, per role (AR, light, 1440).
const landing = {};
for (const [key, lang] of [
  ["admin", "ar"],
  ["sales", "ar"],
  ["finance", "ar"],
  ["agentAdmin", "ar"],
  ["agentSales", "ar"],
]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: lang });
  const page = await login(ctx, PERSONAS[key]);
  const path = new URL(page.url()).pathname;
  const t = await tiles(page);
  landing[key] = { path, tiles: t };
  const expectedPath = key.startsWith("agent") ? "/agent" : "/";
  check(`${key}: lands on Home (${expectedPath})`, path === expectedPath, path);
  check(
    `${key}: Home shows tiles`,
    t.filter((x) => x.size === "module").length > 0,
    `${t.length} tiles`,
  );
  await page.screenshot({ path: `${OUT}/home-${key}-${lang}-light-1440.png` });
  await ctx.close();
}
const mods = (k) => landing[k].tiles.filter((t) => t.size === "module").map((t) => t.href);
check(
  "finance persona sees Finance but not Settings",
  mods("finance").some((h) => h.startsWith("/finance")) &&
    !mods("finance").some((h) => h.startsWith("/settings")),
  mods("finance").join(" "),
);
check(
  "sales persona sees no Finance/Settings tile",
  !mods("sales").some((h) => h.startsWith("/finance") || h.startsWith("/settings")),
  mods("sales").join(" "),
);
check(
  "agent admin sees more portal tiles than agent sales",
  mods("agentAdmin").length > mods("agentSales").length,
  `${mods("agentAdmin").length} vs ${mods("agentSales").length}`,
);
check(
  "agent tiles stay inside /agent",
  [...mods("agentAdmin"), ...mods("agentSales")].every((h) => h.startsWith("/agent/")),
  "",
);
check(
  "staff tiles never point into /agent",
  ["admin", "sales", "finance"].every((k) =>
    mods(k).every((h) => h !== "/agent" && !h.startsWith("/agent/")),
  ),
  "",
);
check("Dashboard is a separate tile → /dashboard", mods("admin").includes("/dashboard"), "");

// 2 — Server-side enforcement: the API refuses what Home does not offer.
const endpoints = {
  finance: "/journal-entries?limit=1",
  settings: "/users?limit=1",
  hr: "/employees?limit=1",
};
const salesTok = await apiToken(PERSONAS.sales);
const agentTok = await apiToken(PERSONAS.agentSales);
const adminTok = await apiToken(PERSONAS.admin);
for (const [mod, path] of Object.entries(endpoints)) {
  const get = async (tok) =>
    (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tok}` } })).status;
  const [s, a, ad] = [await get(salesTok), await get(agentTok), await get(adminTok)];
  check(
    `API ${mod}: sales 403, agent 403, admin 200`,
    s === 403 && a === 403 && ad === 200,
    `sales=${s} agent=${a} admin=${ad}`,
  );
}

// 3 — Deep links and login return URLs.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.sales, "/crm/leads");
  check(
    "login with ?next=/crm/leads returns to the deep link",
    new URL(page.url()).pathname === "/crm/leads",
    page.url(),
  );
  await page.goto(`${process.env.BASE ?? "http://localhost:4401"}/finance/chart-of-accounts`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);
  const txt = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "sales persona opening /finance by URL is denied by the route guard",
    /(غير مصرح|لا تملك|Access denied|not authorized|ليس لديك)/i.test(txt),
    txt.slice(0, 120),
  );
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.agentAdmin, "/agent/orders");
  check(
    "agent login with ?next=/agent/orders returns to the deep link",
    new URL(page.url()).pathname === "/agent/orders",
    page.url(),
  );
  await ctx.close();
}

// 4 — Tile default / hover / keyboard focus (admin, AR light), plus EN dark and 390px.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.admin);
  const tile = page.locator('[data-slot="launcher-tile"][data-size="module"]').nth(1);
  const styleOf = () =>
    tile.evaluate((el) => {
      const cs = getComputedStyle(el);
      const icon = getComputedStyle(el.querySelector('[data-slot="launcher-icon"]'));
      return {
        transform: cs.transform,
        border: cs.borderColor,
        shadow: cs.boxShadow.slice(0, 60),
        iconBg: icon.backgroundColor,
        iconFg: icon.color,
        outline: cs.outlineStyle,
      };
    });
  const rest = await styleOf();
  await page.screenshot({ path: `${OUT}/home-tile-default.png` });
  await tile.hover();
  await page.waitForTimeout(350);
  const hover = await styleOf();
  await tile.screenshot({ path: `${OUT}/home-tile-hover.png` });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  await page.locator('[data-slot="launcher-tile"]').first().focus();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(350);
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return {
      slot: el.getAttribute("data-slot"),
      outline: cs.outlineStyle + " " + cs.outlineWidth,
      transform: cs.transform,
    };
  });
  const fb = await page.evaluate(() => {
    const r = document.activeElement.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({
    path: `${OUT}/home-tile-focus.png`,
    clip: {
      x: Math.max(0, fb.x - 10),
      y: Math.max(0, fb.y - 10),
      width: fb.width + 20,
      height: fb.height + 20,
    },
  });
  check(
    "tile hover rises and fills the icon chip",
    hover.transform !== rest.transform && hover.iconBg !== rest.iconBg,
    `${rest.iconBg} → ${hover.iconBg}; ${hover.transform}`,
  );
  check(
    "keyboard focus shows a ring and the same lift",
    focused.slot === "launcher-tile" &&
      /solid/.test(focused.outline) &&
      focused.transform !== "none",
    JSON.stringify(focused),
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("Home has no horizontal overflow at 1440", overflow <= 0, String(overflow));
  await ctx.close();
}
{
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en",
    colorScheme: "dark",
  });
  const page = await login(ctx, PERSONAS.admin);
  await page.screenshot({ path: `${OUT}/home-admin-en-dark-1440.png` });
  await ctx.close();
}
for (const [key, w] of [
  ["sales", 390],
  ["agentSales", 390],
  ["admin", 768],
]) {
  const ctx = await b.newContext({
    viewport: { width: w, height: 844 },
    locale: "ar",
    isMobile: w < 500,
  });
  const page = await login(ctx, PERSONAS[key]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`Home at ${w}px (${key}) has no horizontal overflow`, overflow <= 0, String(overflow));
  await page.screenshot({ path: `${OUT}/home-${key}-ar-light-${w}.png` });
  await ctx.close();
}

await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
