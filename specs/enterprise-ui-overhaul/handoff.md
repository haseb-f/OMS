# Handoff — enterprise-ui-overhaul

**Status:** Round 1 COMPLETE (2026-09-27); Round 2 COMPLETE (2026-09-28); Rounds 3–4 COMPLETE and released (2026-09-28).

- **Rounds 3–4 (current design):** the owner approved the Round 4 local preview (Microsoft
  Clarity reference polish on the Round 3 Vercel-reference pilot) and it was rolled out as the only
  design on 2026-09-28. Rules: `design-system.md` §12 (tokens in `globals.css` / `tokens.css`,
  recipes in `theme/recipes.css`); decisions: `spec.md` "Round 4 rollout".
- **Rollout evidence:** `verification.md` §"Round 4 rollout"; route sweep
  `tmp/pilot/rollout-sweep` (136 routes × desktop/phone, 0 overflow, 0 console errors);
  before/after `tmp/pilot/compare-r4.html`; independent review findings and fixes listed there.
- **Commits:** b76dabd (design app-wide), ec887d0 + 370acfc (E2E / contrast checks), b03645f
  (specs); release verified HEAD = origin/main = Production (see `verification.md`).
- **Known leftovers:** see `spec.md` "Round 4 rollout" → Known leftovers, and `verification.md`
  §"Round 4 rollout" → Remaining gaps.

- **Round 2** covers:
  - selector triggers as tonal buttons
  - compact fields
  - organized headers (`HeaderActions`)
  - visible feedback (form error summary, task progress, top toasts)
  - the financial report header and reconciliation card
  - the sidebar active rail
- **Round 2 evidence:** `verification.md` (Round 2 section), `review-r2.md`, `kumo-research.md`, and
  `tmp/ui-controls/r2-{before,after}`.
- **Decision pending for the owner:** on phones, «تحويل إلى طلب» on a lead sits under «المزيد»
  because «إضافة متابعة» is the page's primary action.

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
