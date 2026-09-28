/**
 * Round 3 design pilot (specs/enterprise-ui-overhaul/spec.md, "Round 3").
 *
 * The Vercel-reference ("geist") design is a scoped mode: `data-ui="geist"`
 * on <html> activates the pilot tokens and recipes in `theme/pilot-geist.css`.
 * It is on only when the build carries `NEXT_PUBLIC_UI_PILOT=geist` (local
 * `.env.local`) AND the current route is a pilot route, so every other route
 * and every other environment keep the current design untouched.
 *
 * Reviewers can compare in place with `?ui=classic` / `?ui=geist`, which is
 * remembered in localStorage (`UI_PILOT_STORAGE_KEY`).
 */
export const UI_PILOT_ENABLED = process.env.NEXT_PUBLIC_UI_PILOT === "geist";

export const UI_PILOT_STORAGE_KEY = "oms.uiPilot";

/** Pilot routes, as one regex source shared with the pre-paint script. */
export const UI_PILOT_ROUTE_PATTERN =
  "^/(?:$|crm/leads(?:/[^/]+)?/?$|sales/invoices/[^/]+/?$|store-orders/[^/]+/?$|reports/finance/?$|design-system/?$)";

const routeRegex = new RegExp(UI_PILOT_ROUTE_PATTERN);

export function isUiPilotRoute(pathname: string | null | undefined): boolean {
  return Boolean(pathname) && routeRegex.test(pathname!);
}

/**
 * Runs in <head> before first paint so a pilot route never flashes the
 * classic design. Mirrors `UiPilotProvider` (which takes over on client
 * navigation).
 */
export const UI_PILOT_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  UI_PILOT_STORAGE_KEY,
)},q=new URLSearchParams(location.search).get("ui");if(q==="classic")localStorage.setItem(k,"off");if(q==="geist")localStorage.removeItem(k);if(localStorage.getItem(k)==="off")return;if(new RegExp(${JSON.stringify(
  UI_PILOT_ROUTE_PATTERN,
)}).test(location.pathname))document.documentElement.setAttribute("data-ui","geist");}catch(e){}})();`;
