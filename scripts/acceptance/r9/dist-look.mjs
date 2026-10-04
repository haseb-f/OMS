import { chromium, login, PERSONAS, BASE } from "./lib.mjs";
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 1440, height: 500 },
  locale: "ar",
  deviceScaleFactor: 2,
});
const page = await login(ctx, PERSONAS.admin);
const base = {
  eligible: [{ id: "u1", fullName: "A", email: "a@x" }],
  eligibleCount: 1,
  pendingEligibleCount: 7,
  held: { count: 0, batches: [] },
  team: null,
  excluded: [],
};
const pol = (mode, x = {}) => ({
  id: "p",
  mode,
  isActive: true,
  startedAt: new Date().toISOString(),
  expiresAt: null,
  remainingMs: null,
  teamId: null,
  ...x,
});
const S = {
  continuous: { ...base, status: "CONTINUOUS", policy: pol("CONTINUOUS") },
  timeLimited: {
    ...base,
    status: "TIME_LIMITED",
    policy: pol("TIME_LIMITED", {
      expiresAt: new Date(Date.now() + 7e7).toISOString(),
      remainingMs: 7e7,
    }),
  },
  manual: { ...base, status: "MANUAL", policy: pol("MANUAL") },
  paused: { ...base, status: "PAUSED", policy: pol("PAUSED") },
  blocked: {
    ...base,
    eligible: [],
    eligibleCount: 0,
    status: "CONTINUOUS",
    policy: pol("CONTINUOUS"),
    failureCode: "NO_ELIGIBLE_EMPLOYEES",
    failureReason: "x",
  },
};
for (const [n, snap] of Object.entries(S)) {
  await page.route("**/leads/distribution", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) })
      : r.continue(),
  );
  await page.goto(`${BASE}/crm/leads`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const el = page.getByTestId("lead-distribution-control");
  const box = await el.boundingBox();
  await page.screenshot({
    path: `D:/Systems/OMS-r9-brand-grid/specs/round9-brand-grid/evidence/correction/distribution-${n}-header.png`,
    clip: {
      x: Math.max(0, box.x - 40),
      y: Math.max(0, box.y - 12),
      width: box.width + 80,
      height: box.height + 24,
    },
  });
  await page.unroute("**/leads/distribution");
}
await b.close();
