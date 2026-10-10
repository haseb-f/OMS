# S2 — Agent overview separate from agent management; one report-card treatment

## Destinations

- **نظرة عامة على الوكلاء / Agents overview** (`/agents/overview`, company, `agents.view`): the cross-agent
  summaries, metrics and reporting now shown as the `AgentsOverviewPanel` secondary panel on `/agents`.
- **إدارة الوكلاء / Agent management** (`/agents`, existing): the table, search/filters, create/edit — no
  overview panel any more (no duplicated content). Agent detail pages keep their own tabs.
- Agent portal: `/agent/dashboard` is the agent's overview (admin: own agent; sales employee: own personal
  metrics only — existing scope); `/agent/team` stays management. Names in the sidebar make the split clear.
- Navigation: entries in `navigation.config.ts` (+ `home.destinations.*` lines ar/en, module overview).
- No company cost/margin in any agent-facing card (existing redaction rules kept; tests assert it).

## Report cards

Audit `components/shared/insight-card.tsx` (InsightCard/SummaryCard/InsightGroup/InsightSurface) and
`components/agents/summary-card.tsx` (+ every consumer). One shared treatment for report summary cards:
semantic tone per card (info/success/warning/destructive/neutral tokens), soft glass-like surface (tinted
translucent fill + hairline border + soft shadow, AA text contrast), clear icon chip, prominent tabular value;
hover: slight lift via shadow/border emphasis (no size/position change → no layout shift), identical
`:focus-visible` treatment for focusable cards, `@media (hover: none)` resting state already distinct,
`prefers-reduced-motion` disables transitions. Duplicate card implementations converge on the shared one.
Record-grid status cards (`renderGridCard`, flat tinted) are NOT changed.

## Verification

Company admin / agent admin / agent sales sessions: navigation shows the right destinations; overview shows
only permitted figures; management keeps create/edit; card hover/focus/touch/reduced-motion screenshots.
