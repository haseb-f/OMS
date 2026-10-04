# Round 8 — Home launcher and dashboard refinement: evidence (local review)

**Status: implemented and verified locally — NOT deployed. Awaiting the owner's visual approval.**

- Branch / commit: `feat/r8-home-dashboard` (worktree `D:/Systems/OMS-r8-home`), on top of the deployed
  blue-dropdown rollout `204ccca`. Production is still `204ccca`; nothing from this branch is on Production.
- Review stack: web **http://localhost:4401** (`web-r8-home`, production build of this branch), API
  **http://localhost:4405** (`api-r8-blue`, API build of `main`), database `oms_r7_final` (local demo
  clone, the same data the previous preview used). Login personas: `demo-r7-*@oms.local` and
  `*.demo-agt@oms.local` (shared demo password in `tmp/r7-final/.r7.env`, not recorded here).
  The browser is verified to load this build: Home shows the new tiles; the old preview (:4301) does not.

## Gates

| Gate                 | Result                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Web typecheck        | clean                                                                                     |
| Web lint             | 0 errors (11 warnings — identical to `main`)                                              |
| Web tests            | 105 files / 759 tests pass (28 new: tiles builder, launcher, tile, insight card)          |
| Web production build | success (`/`, `/dashboard`, `/agent`, `/agent/dashboard` all built)                       |
| Contrast check       | all pairs pass, light + dark (new: 10 hues × launcher pairs, tone tiles rest/hover, rows) |
| API                  | untouched (identical to deployed `main`)                                                  |

## Browser evidence — fresh captures of this build (`evidence/*.png`)

Scripts: `scripts/acceptance/r8/verify-home.mjs`, `verify-dash.mjs`, `verify-forms.mjs` (Playwright).

**Home after a normal login** — 28/28 checks (AR light 1440; plus EN dark 1440, 390 px and 768 px):

| Persona (demo) | Lands on | Tiles                                          |
| -------------- | -------- | ---------------------------------------------- |
| Company admin  | `/`      | 15 modules (Dashboard first) + 7 quick actions |
| Sales A        | `/`      | Dashboard, CRM, Sales, Products                |
| Finance        | `/`      | Dashboard, Finance (no Settings)               |
| Agent Admin    | `/agent` | 8 portal pages                                 |
| Agent Sales    | `/agent` | 3 portal pages                                 |

- Deep links: `?next=/crm/leads` (company) and `?next=/agent/orders` (agent) land on the link, not Home.
- Authorization is enforced server-side as well: sales and agent tokens get **403** from the finance,
  settings and HR endpoints behind tiles they are not shown; admin gets 200. A sales user opening
  `/finance/...` by URL is stopped by the route guard.
- Tile default / hover / keyboard focus: hover = 2 px rise + icon chip fills solid; focus = 2 px ring
  - same lift (`home-tile-default.png`, `-hover.png`, `-focus.png`).
- No horizontal overflow at 1440, 768 and 390.

**Dashboards** — 41/41 checks (company AR light + EN dark, agent AR light, sales AR light, two phone widths):

- Toned cards are visible tinted gradient surfaces; headline figures 28 px.
- Static summaries stay flat (default cursor, no transform). Interactive cards (company: new leads,
  converted, orders, delivered, in progress; agent: all orders, all leads, available funds, payouts)
  show a pointer + chevron; hover/focus: 1 px rise, stronger border, icon chip filled, figure size
  unchanged, **own box and neighbour unchanged (no layout shift)**; keyboard focus ring `solid 2px`.
- Evidence: `dashboard-*-1440.png`, `card-default|hover|focus-*.png`, `dashboard-*-390.png`.

**Blue dropdowns in forms** (integrated build): create product and edit user dialogs, triggers all
default tone 3 (`forms-create-product-ar-light.png`, `forms-edit-user-ar-light.png`); toolbars and
report filter rows are in `../round8-blue-dropdowns/evidence/`.

## A defect found and fixed by this verification

Insight cards, the attention rows and the new tiles used `outline-none focus-visible:outline-2` without
`outline-solid`; under Tailwind v4 the focus ring was never painted (computed `outline-style: none`).
Fixed for all three; asserted in `insight-card.spec.tsx` / `launcher-tile.spec.tsx`.

## Not done / for the owner

- **Visual approval** of Home and the revised dashboards, then merge + deploy (not done on purpose).
- Home has no pinned/recent pages row and no search — intentionally minimal; the sidebar and
  command palette remain.
- Dashboard drill-downs open the owning list unfiltered (list pages do not read status query
  parameters); only the leads page reads `followUp`.
- Print layout of Home/Dashboard: Home is a launcher (not printable, decorative wash hidden in print);
  the dashboards' print behaviour is unchanged.
