# Handoff — enterprise-ui-overhaul

**Status: COMPLETE (2026-09-27).**

- **Evidence:** see `verification.md` for gates, before/after density, route coverage, Production
  journeys and remaining gaps, and `review.md` for the independent review and its re-verification.
- **Release:** HEAD = origin/main = Production, verified at the final push (see the git log; the
  SHA isn't recorded here because recording it would change it).
- **Commits:**
  - foundation 169f4c9
  - feedback dbc839b
  - reports b140965
  - tables d263b2b
  - documents bef13f9
  - adoption a39cbb1
  - specs 6947515
  - fixes 3490007 (payment review rows), f28d692 (menu focus), a81c898 (picker focus), fcd9938
    (alert contrast)
  - Arabic guide d468b41
- **Design system:**
  - `design-system.md` is canonical.
  - Tokens are in `apps/web/src/app/globals.css` and `theme/tokens.css`. Run
    `node scripts/design/contrast-check.mjs` before changing any color token.
  - Before/after captures come from `scripts/acceptance/ui-baseline.mjs` (`PHASE=…`, `PAGES=nav` for
    every sidebar route).
- **Decisions:**
  - Numeric columns align to the logical end.
  - Latin digits in both locales.
  - Buttons and fields share one height: 32px, or 40px on touch.
  - Phones and tablets below 1024px use the navigation sheet.
  - List pages fill the viewport on desktop, so the grid is the only scroller.
  - Report balances show Dr/Cr, and zero shows as "—".
- **Open items:** see `verification.md` §"Remaining gaps". Item 10 (declare after dispute) is a
  payment-rule question for the owner.
