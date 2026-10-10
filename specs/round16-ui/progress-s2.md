# S2 progress — agent overview vs management + one report-card treatment

Branch `feat/r16-agent-overview` (worktree `D:/Systems/OMS-r16-w2`).

## Log

- 2026-10-10 — Read spec, guardian, shared cards (`InsightSurface` / `InsightCard` / `SummaryCard` /
  `ReportCard`) and the recipes block. Findings: `/agents/overview` was served by `agents/[id]` (id
  "overview"); card hover used `translateY` / icon `scale` (position + size change); hover rules were not
  gated on `(hover: hover)` (sticky hover on touch); static report cards had no hover response at all;
  the icon chip and the interactive wrapper classes were re-implemented in `SummaryCard`, `ReportCard`
  and the partner login card; two loading skeletons (`overview-panels`, `sales-panels`) drew a bare
  `data-slot="insight-card"` div without the card border.
- 2026-10-10 — Implemented:
  - Navigation: `agents-overview` (`/agents/overview`, `agents.view`, order 0) before `agents-list`
    (renamed «إدارة الوكلاء / Agent management»), collections order 2; `home.destinations` lines ar + en
    for both. Agent portal: «الفريق» → «إدارة الفريق / Team management»; the dashboard keeps its R6
    owner-approved name «لوحة التحكم / Dashboard» (guarded by `r6-navigation.spec.ts`).
  - `app/(shell)/agents/overview/page.tsx` — static segment (wins over `[id]`), `PermissionGate
agents.view`, read-only `AgentsOverview` (company totals as `InsightCard`s, then «حسب الوكيل»
    `SummaryCard`s, 12 agents per page with `ListPager`; each card links to `/agents/<id>`; the
    collections tile links to `/agents/collections` only when the API returns finance figures).
  - `/agents` = management only (table, search / filters, create / edit) — overview panel removed; a
    secondary header link goes to the overview. `agents-overview-panel.tsx` → `agents-overview.tsx`.
  - Cards: `InsightSurface` is the one card wrapper (div / link `href` / button `onSelect` + `pressed`),
    `InsightIcon` the one icon chip, `INSIGHT_FOCUS_CLASS` the one focus ring, `InsightCardSkeleton
context` the one skeleton. Converged: `InsightCard`, `SummaryCard` (+ optional `href` / chevron),
    `ReportCard` (+ skeleton), partner login card, agent overview group skeleton, dashboard sales
    skeleton.
  - `theme/recipes.css` report-card block rewritten on custom properties: paint-only (no transform),
    hover under `@media (hover: hover)`, focus-visible identical to hover, static cards a quiet edge +
    shadow, interactive cards resting lift + pointer + chevron, reduced motion → no transitions. New
    tokens `--insight-tint-border-hover`, `--insight-static-hover-shadow` (light + dark, globals.css).
    Record-grid cards untouched.
  - Tests: `navigation/agents-overview-management.spec.ts` (12), `components/shared/
report-card-treatment.spec.tsx` (11), `components/agents/overview/agents-overview.spec.tsx` (5).
- Verification: web tsc OK; eslint + prettier on changed files OK; full web vitest 169 files /
  1204 tests pass; contrast-check all pairs pass; `next build` OK (`/agents/overview` built). No
  browser pass (lead's step).

## Open

- Visual review (hover / focus / touch / reduced-motion screenshots) by the lead in the one browser
  pass; owner approval before deploy.
- Agent portal dashboard name left as «لوحة التحكم» (R6 owner decision) — rename only if the owner asks.
