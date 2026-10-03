# Round 6 visual (workstream E) — evidence, 2026-10-01

Branch `feat/r6-visual` (= `feat/r5-visual` + `main`). Local preview only, waiting for owner approval.
Captured with Playwright (`tmp/r6/shots.mjs`; the company dashboard, report and interactive shots
were re-taken on 2026-10-03 with `tmp/r6/shots2.mjs`) on the local API :3605 and web :3601. The DB is
`oms_r6_visual`, a clone of dev. Reduced motion is on, the Next dev badge is hidden, and the
viewport is 1440 or 390 wide.

**Load guard (re-take).** The first capture of the company dashboard and the report saved
skeletons. It waited a fixed 1.2s, and `/auth/me` alone takes about 2s under `next dev`. The
endpoints themselves are fast on `oms_r6_visual`: each `/sales/performance` period, the payment
counts and the bank counts answer in 0.1–0.5s, and the trial balance in about 0.2s. No API errors
were logged. The re-take waits for three things, and otherwise fails instead of saving:

- the page's own content (sales figures or report rows)
- no `[data-slot="skeleton"]`, no `aria-busy`, and no «جارٍ التحميل» / "Loading…" text
- the same condition still true 1.5s later

**Tile tuning (2026-10-03).** The metric tiles were re-tuned so their colour is easier to see.
Each toned tile is now its own soft card with an 8px gap and:

- a tone gradient, 12% → 3.5% in light and 18% → 6% in dark
- a hairline at 28% of the tone (32% in dark)
- an icon chip at 18% (26% in dark)

Neutral tiles stay plain, and tiles have no shadow at rest. Seven "after" files were re-taken with
the same load guard:

- company dashboard: AR light 1440, EN dark 1440, AR light 390
- Agent Admin dashboard: AR light 1440, EN dark 1440
- Agent Sales dashboard: AR light 1440
- trial balance, expanded: AR light 1440

The other "after" dashboard and report variants, plus the interactive attention shots, show the
pre-tuning tiles. All pairs in `contrast-check.mjs` pass, including the new tile label and value
pairs on the strongest tint.

**Before** comes from `main` @ `901e075`, served from a temporary `git worktree` against the same
API and data, which was removed afterwards. **After** comes from this branch.

## Personas

| Persona     | Login                                                     | Notes                                                                                    |
| ----------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Company     | `admin@oms.local`                                         | Seed admin                                                                               |
| Agent Admin | `demo-r6-x-admin@oms.local`                               | Agent «Agent A F904DA», preset ADMIN                                                     |
| Agent Sales | `demo-r6-x-sales@oms.local`                               | Same agent, preset SALES. Own scope: 3 DEMO-R6 leads and 1 order (`STO-2026-024737`)     |
| Second pair | `demo-r6-y-admin@oms.local` / `demo-r6-y-sales@oms.local` | Agent «Portal Agent A F5ECAF», used for isolation (`STO-2026-024738`). Not screenshotted |

All four users are tagged `DEMO-R6-20261001`. They share one password, kept in
`tmp/r6/.demo.env`, which is gitignored and never printed.

## Files

Names follow `<phase>-<subject>-<locale>-<theme>[-<width>].png`, where locale is `ar` (RTL) or
`en` (LTR) and theme is `light` or `dark`.

| Subject                                                                                    | Before                                             | After                                              |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------- |
| Company dashboard (1440 + 390)                                                             | `before-company-dashboard-*`                       | `after-company-dashboard-*`                        |
| Agent Admin dashboard (1440 + 390)                                                         | `before-agent-admin-dashboard-*`                   | `after-agent-admin-dashboard-*`                    |
| Agent Sales dashboard (1440 + 390)                                                         | `before-agent-sales-dashboard-*`                   | `after-agent-sales-dashboard-*`                    |
| Trial balance, 01 Jan – 01 Oct 2026, summary expanded (1440, first screen)                 | `before-financial-report-trial-balance-expanded-*` | `after-financial-report-trial-balance-expanded-*`  |
| Same report, summary collapsed (after only; `main` has no collapse)                        | —                                                  | `after-financial-report-trial-balance-collapsed-*` |
| Dashboard interactive rows (Needs attention): hover and keyboard focus, AR light + EN dark | —                                                  | `after-interactive-attention-{hover,focus}-*`      |

### Dropdown trial

All trial shots are at 1440. Each subject comes in three variants: `trial-off-*` (the current
canonical design), `trial-a-*` and `trial-b-*`.

| Subject                    | Page                                            | File stem                    |
| -------------------------- | ----------------------------------------------- | ---------------------------- |
| List filter toolbar        | `/crm/leads`                                    | `trial-<v>-toolbar-*`        |
| Form                       | `/sales/invoices/new`                           | `trial-<v>-form-*`           |
| Dialog                     | New lead, `/crm/leads`                          | `trial-<v>-dialog-*`         |
| Financial report filters   | `/reports/finance?report=trialBalance`          | `trial-<v>-report-filters-*` |
| All states, beside buttons | Control-states board, `/design-system`          | `trial-<v>-states-*`         |
| Open state                 | Control-states board with the first select open | `trial-<v>-states-open-*`    |

The control-states board shows these states:

- placeholder, selected, invalid and disabled
- an unset filter, an applied filter and an applied filter with a count
- the primary, success, outline and destructive buttons next to them

Hover and focus-visible are captured for trial B on the board's selected-value trigger, in AR light
and EN dark: `trial-b-interactive-{hover,focus}-*`. Pressed is live on the board but not captured.

Metric tiles are static by design, so they have no hover. The interactive rows on the dashboard
are the Needs-attention queues, shown in the interactive dashboard shots.

## How to run the trial locally

The switch is local only. With nothing set, the canonical design applies, so a deploy changes
nothing. There are three ways to control it:

- Set `NEXT_PUBLIC_TRIGGER_TRIAL=a` or `=b` in `apps/web/.env.local`. This is never set on Vercel.
- In `next dev`, open any page with `?triggerTrial=a` or `?triggerTrial=b`. The choice is kept for
  the tab in sessionStorage.
- Use `?triggerTrial=off` to clear it.

Contrast for both trials, light and dark, is checked in `scripts/design/contrast-check.mjs`, and
all pairs pass.

## Recommendation: **B (restrained)**

1. **Hierarchy.** On every real screen A puts a row of solid navy blocks next to the one solid
   navy primary action. The leads toolbar is the clearest case: four navy filters sit beside
   «Add New», and the pager select sits beside the navy page buttons. That breaks the §12.4 rule
   of exactly one filled primary per context. The radius and chevron chip keep A technically
   distinguishable, but at a glance the eye lands on the filters instead of the action.
2. **Density and fatigue.** Users spend more than 8 hours a day here. Large navy areas, as on the
   leads toolbar or a form with six selects, make the canvas heavy and work against the calm,
   Clarity-like surfaces this round introduces. B adds identity without adding mass.
3. **State legibility.** In B each state reads as a change of one channel:
   - placeholder: navy text at weight 400
   - selected value: navy text at weight 500
   - hover: deeper edge
   - open: navy edge and an inset
   - applied filter: navy tint fill

   In A every state is a variation of dark-on-dark. Applied, hover and open differ only by small
   shifts in the navy, and in dark mode A needs a lifted navy plus a blue hairline just to
   separate it from the canvas (3.9:1).

4. **Semantic colours.** Status badges inside triggers, and the red invalid ring and halo, keep
   their meaning on B's white field. On A's navy they compete with the fill.
5. **Inputs vs selectors.** B keeps selectors in the same family as text inputs (white field, a
   navy-tinted 1.5px edge instead of the neutral 1px). Mixed form rows stay aligned and calm, yet
   a selector is still recognisable by its edge and chevron chip.

A could make sense later as an accent for one specific control, such as a page-level scope or
company switcher, but not as the default trigger.

If the owner approves B, it becomes the canonical trigger in three steps:

1. Fold the B tokens into `--selector*` / `--control-*`.
2. Move the B rules into `theme/recipes.css`.
3. Delete `theme/trigger-trial.css` and the switch.
