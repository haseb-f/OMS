# Round 8 — Home launcher and dashboard refinement (local review, not deployed)

Branch `feat/r8-home-dashboard` (worktree `D:/Systems/OMS-r8-home`), on top of the deployed
blue-dropdown rollout (`204ccca`, `feat/r8-blue-dropdowns`). Owner decision 2026-10-04: show Home and
the revised dashboards locally for visual approval **before** deploying.

## Investigation — why the dashboard "still appeared unchanged"

| Question                         | Finding                                                                                                                                                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the work on another branch?   | No. R6/R7 dashboard commits (`67729f5`, `6126581`, `898c9e0`, `77ef66c`) are already on `main`; the owner's preview (`preview/r7-toolbar-dashboards`, web :4301 / API :4305, DB `oms_r7_final`) is `main@98ac4bb` + the toolbar commits — it contained exactly those dashboards. |
| Is CSS overriding it?            | No. The tone tiles rendered as designed; no later rule neutralised them.                                                                                                                                                                                                         |
| Then why does it look unchanged? | Because the design was deliberately faint: tile tint 14.5 % → 5.5 %, a 24 px icon chip, 22 px figures, panel headers 11 %, plain white panel bodies, and a hover that only changed the border/shadow. At a glance the screen read as white cards with tiny icons.                |
| Was a Home screen ever built?    | No. Nothing in the repository, any branch or any spec implemented "Home / الشاشة الرئيسية"; `/` was the dashboard and "Home" existed only as the breadcrumb root. It was an incomplete requirement, not a lost change.                                                           |

## What this round implements

1. **Home** — `/` (company) and `/agent` (agent portal) is a separate permission-aware launcher
   (`components/home/home-launcher.tsx`, `navigation/home-tiles.ts`). Tiles derive from
   `navigation.config.ts` through `filterNavigationByAuth` / `buildNavigationTree` (the sidebar's own
   filter) and, for the quick actions, `resolveRouteAccess` (the route guard's own rule). Login lands
   on Home (`homePathFor`), valid `?next=` deep links still win. Dashboard moved to `/dashboard`
   and `/agent/dashboard` (own nav entries, Home first).
2. **Dashboard visual layer** — visibly toned glass-like tiles and panels, larger figures,
   hover / focus response, interactive vs static distinction, panel rows (design-system §12.17).
3. **Contrast** — every new colour pair is in `scripts/design/contrast-check.mjs` (10 hues × light/dark,
   tone tiles at rest and hover, panel rows). The checker found 34 failing pairs while tuning; all fixed.

## Authorization

Tile visibility is derived from the server-issued permission set (`/auth/me`) with the same
filters the sidebar and route guard use — no second rule. The destination itself is enforced
again by the shell route guard and, for every figure and record, by the API's permission guards
(`verify-home.mjs` proves sales/agent users get 403 from the finance/settings/HR endpoints behind tiles
they are not shown, and admin gets 200). Home carries no data of its own.

## Not done / follow-ups

See `evidence.md`.
