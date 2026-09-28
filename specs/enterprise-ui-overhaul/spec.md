# Spec — Enterprise UI/UX Design System Overhaul

Milestone: `enterprise-ui-overhaul` · Round 1 COMPLETE (2026-09-27) · **Round 2 ACTIVE** (2026-09-27, see
"Round 2" at the end)

Start condition: `payment-declaration-reconciliation` is released and verified (QA and DOC done,
HEAD = origin/main = Production). No concurrent changes to shared components before then.

## Goal

Make OMS feel like a polished enterprise platform: Vercel-inspired precision, restrained colors, solid
surfaces, excellent typography, dense useful information and effortless navigation. An original identity
suited to operational and financial software. Business behavior, permissions, accounting calculations and
existing workflows are preserved.

A comprehensive visual and interaction redesign — not isolated CSS fixes.

## Scope

1. **Audit and design system.** Inventory all routes and shared components (inconsistent styles,
   duplicates, wasted space, usability problems). One canonical implementation on shadcn/ui primitives and
   shared semantic tokens; the existing design system may be rebuilt where necessary. Define:
   - Arabic/English typography: heading, body, table, label and numeric hierarchies.
   - Spacing, heights, widths, radii, borders, shadows, layering.
   - Solid light/dark surfaces, restrained elevation, coherent navigation.
   - Semantic colors: primary, info, success, warning, danger, disabled.
   - Loading, empty, error, selected, hover and keyboard-focus states.
   - Avoid gradients, glass, oversized cards, decorative whitespace, page-specific styling.
2. **Shell and dashboard.** Sidebar, top bar, breadcrumbs, page headers, toolbars, contextual navigation.
   Clear active location, grouped navigation, compact headers, one primary action per context. Role-relevant
   dashboard (actionable metrics, pending work, exceptions, drill-downs); no decorative metrics or charts
   disconnected from real data. Payment vs fulfillment status stays explicit.
3. **Tables and density.** One table system: compact default (optional comfortable), exact header/body/
   footer alignment incl. sort/filter icons, consistent rows/padding, numeric alignment, date/reference
   formatting, column widths/resizing/visibility, sticky headers, controlled internal scroll, selection,
   bulk actions, pagination, loading/empty states, truncation with full-value access. No nested scrolling.
   Record before/after visible-row counts on representative pages.
4. **Inputs, search, selectors.** Unify inputs, search, selects, comboboxes, date pickers, filters via
   shared shadcn/ui components. Searchable selection, quick-create at top, keep product browsing/
   multi-select and inline creation, correct keyboard/touch and placement, keep caching/debouncing.
5. **Document editors** (invoices, quotations, orders, payments, journals, inventory, assets, investors,
   HR, …). Clear identity/status/party/dates, dense editable lines without clipping, strong totals
   hierarchy, related-document previews, predictable return navigation, validation without data loss,
   mobile line-item cards, consistent print/PDF with readable Arabic and correct page breaks.
6. **Financial reports — highest visual priority.** Shared report presentation system: perfect RTL/LTR
   alignment; distinct sections, parent accounts, detail rows, subtotals, final balances; tabular digits;
   quiet zeros; negative semantics not by color alone; COA hierarchy, expand/collapse, filters, drill-down
   intact; summary cards (revenue soft blue, expense orange/red, net profit green, net loss red) applied to
   summaries only; Balanced/Unbalanced + discrepancy as a deliberate summary. GL, TB, P&L, BS, Cash Flow,
   statements, aging, treasury. Exports/print respect language, filters, values, hierarchy. Financial
   accuracy unchanged.
7. **Responsive, RTL, accessibility.** Logical properties, correct drawer side/icons/direction, isolated
   numbers/references, no page-level horizontal overflow, report tables scroll in their own container with
   labels kept, dialogs fit viewport with actions reachable over the mobile keyboard, WCAG AA contrast,
   visible focus, touch targets. Verify light/dark × ar/en × phone/tablet/desktop.
8. **Approach.** Establish direction on representative screens (dashboard, lead/order table, invoice
   editor, financial report, mobile workflow), render and refine, then roll out across ALL routes — no
   mixed old/new styling. Subagents with non-overlapping ownership (inventory, shared components, module
   adoption, independent visual/a11y review); Master integrates. No unrelated backend changes; fix blocking
   functional defects explicitly. Preserve automation selectors or update tests.

## Acceptance

- Every inventoried screen adopts the shared system; justified exceptions documented.
- No duplicated actions, mismatched controls, header misalignment or clipped essential data.
- Comparable before/after screenshots show improved density and hierarchy — not just smaller fonts.
- Real workflows remain functional; financial reports reconcile.
- No material regression in rendering or lookup performance.
- Production browser evidence covers representative workflows and every shared component state across
  responsive/locale/theme variants.
- Tests, typecheck, lint, production builds pass; logical commits; pushed, deployed, release verified.
- Arabic user-guide screenshots updated after the final design is deployed.
- Final: HEAD = origin/main = Production SHA, and the UI visually inspected and exercised in the
  Production browser. Not COMPLETE from source changes or automated checks alone.

## Constraints

- Routine work authorized; preserve unrelated WIP and Production business data.

## Deliverables

Concise summary, before/after screenshots, route coverage, design-system documentation
(`design-system.md`), remaining gaps, verified release SHA.

## Round 2: compact design, organized headers, distinct controls, report UI (2026-09-27)

This round covers the owner's follow-up brief plus the sidebar and financial-report refinements.
The rules are in design-system.md §11.

**Scope:**

- Kumo research, verified from official sources (`kumo-research.md`).
- Tokens and primitives:
  - selector triggers as tonal buttons
  - compact fields
  - menus, cards and toasts
- Global, page and document headers, with a shared `HeaderActions`.
- Layouts for:
  - the Lead → Store Order dialog
  - the sales invoice
  - the purchase quotation and invoice
  - payment declaration and reconciliation
- Visible contextual feedback:
  - field errors
  - a persistent form error summary
  - header status updates
  - import progress
  - persistent warnings
- The financial-report header, reconciliation summary and report cards, across the GL, TB, P&L, BS,
  CF, statements, aging and treasury reports.
- Sidebar radii and the active rail with glow.

**Acceptance:**

- The deployed UI visibly shows:
  - organized headers, so location, status and next action are clear at a glance
  - compact solid forms
  - button-like dropdown triggers
  - clear feedback
  - the redesigned report header, with balanced and unbalanced states
- Before/after Production screenshots are captured at identical viewports: `tmp/ui-controls/r2-before`
  vs `r2-after`, plus `tmp/ui-baseline`. They cover:
  - header height
  - visible fields and rows
  - wasted space
  - control states
- Checked in Arabic and English, RTL and LTR, phone, tablet and desktop, light and dark, and with
  keyboard and touch.
- Data, validation, permissions, business rules, financial figures and lookup performance are
  unchanged.
- HEAD = origin/main = Production, the Arabic guide screenshots are refreshed, and verification.md is
  updated.

## Round 3: Vercel-reference redesign — LOCAL PILOT (2026-09-28)

The owner did not accept the Round 2 appearance. Round 3 redesigns OMS around the visual quality and
interaction patterns of Vercel's dashboard (Geist), keeping OMS branding, Arabic and all business
behavior. Reference values: `geist-research.md`. Rules: `design-system.md` §12.

**Delivery gate (hard):** a small, working LOCAL pilot first. Nothing is deployed, merged into
`main` or rolled out system-wide until the owner explicitly approves the pilot visually. Passing tests
is not design approval. Work lives on branch `ui/vercel-pilot`.

**Pilot isolation.** The pilot is a scoped design mode, not a fork:

- `data-ui="geist"` on `<html>` activates it. It is set only when `NEXT_PUBLIC_UI_PILOT=geist`
  (local `.env.local` only) **and** the route is a pilot route (`config/ui-pilot.ts`). Every other
  route, and every environment without the flag, renders the current design unchanged.
- Pilot tokens live in `theme/pilot-geist.css` under `[data-ui="geist"]`. Shared primitives gain
  pilot recipes through the `geist:` Tailwind variant only, so their current classes are untouched.
- Reviewers can compare in place: `?ui=classic` / `?ui=geist` (remembered per browser), and a
  «Pilot» switch in the top bar.
- Local data only: web :3001 → API :3005 → local Postgres (Docker :5434). No Production writes.

**Pilot screens.**

| Screen                                  | Route                                         |
| --------------------------------------- | --------------------------------------------- |
| Dashboard + shared header and sidebar   | `/`                                           |
| Lead list                               | `/crm/leads`                                  |
| Lead detail (workflow actions)          | `/crm/leads/[id]`                             |
| Lead → Order dialog (products, payment) | opened from lead detail                       |
| Sales invoice editor                    | `/sales/invoices/new`, `/sales/invoices/[id]` |
| Financial report (Trial Balance)        | `/reports/finance?report=trialBalance`        |

**Acceptance for the pilot (before asking for approval):**

- Every pilot screen works with local demo data and real interactions (no static mockups).
- Geist patterns visible: solid white surfaces on a light canvas, hairline borders, 6/8/12px radii,
  restrained shadows only on floating layers, Geist type for Latin and digits, compact 32px controls.
- Selector triggers are white, deliberate controls with a fixed chevron and distinct hover, open,
  selected (has value) and focus states; no grey tonal or inset/embossed fills.
- Button hierarchy: one filled primary (navy / light in dark); Confirm, Approve and Convert to Order
  use the refined green; destructive actions red; everything else neutral. One height per size.
- Sidebar labels on one line (nested included), shortened where needed; active accent rail kept.
- Dashboard order: needs attention → metrics → operational details; real figures only.
- Lead detail: one clear next action, grouped secondary actions.
- Invoice and order: compact fields, aligned item rows, clear totals, predictable final actions.
- Financial report: reusable header (title, context, filters, actions), summary with the
  reconciliation status ("Balanced" as a meaningful summary), table.
- Validation and outcomes shown next to the action, not only as a toast.
- Arabic/English, RTL/LTR, light/dark, desktop and 390px phone; keyboard reachable; no page-level
  horizontal scroll.
- Evidence: before/after screenshots at matching viewports (`tmp/pilot/before` vs `tmp/pilot/after`),
  open dropdowns, button states and validation examples.

**After approval only:** promote the pilot tokens and `geist:` recipes to the base layer, remove the
superseded styles and the pilot switch, cover every route, run all gates, independent visual review,
commit, push, deploy, verify Production, refresh the Arabic guide screenshots.

### Round 3.1: pilot refinement — actions, vertical forms, expressive cards, distribution (2026-09-28)

Owner feedback on the first pilot: improved, **not approved yet**. Same delivery gate: local only, no
rollout / merge / deploy until the owner explicitly approves the updated preview.

1. **Lead actions** in reading order (mirrored for RTL/LTR): «إضافة متابعة / Add Follow-up» →
   «تحويل إلى طلب / Convert to Order» (refined green) → «المزيد / More» (neutral overflow). One
   follow-up action only: any workflow transition that duplicates it ("Start Follow-up") is folded
   into the Add Follow-up flow, keeping its business effect. Permissions and conversion eligibility
   respected. The stage tracker stays.
2. **Workflow tracker** — one shared component for multi-step operations: real current stage,
   completed stages, next steps; payment and fulfillment as separate tracks; read-only stages are
   never styled as clickable; no invented stages. Pilot demos: lead, store order detail, sales
   invoice. Rollout list (after approval): purchase orders/invoices, payment reconciliation, returns.
3. **Vertical data-entry cards** — creation forms and dialogs as focused cards: softly tinted solid
   surface, section titles + one-line descriptions, 520–640px on desktop, one field column (short
   related fields paired), 10–12px radius, compact (not stretched) buttons, clear footer with
   primary + secondary, mobile scroll with reachable actions. Wide layouts only where needed (line
   tables). Pilot: Add Follow-up and Lead → Order. Data, validation and unsaved-change behavior kept.
4. **Dashboard and report cards** — label, prominent value, context, relevant action; semantic
   accents and coherent icons; small meaningful vector marks only; restrained tinted backgrounds;
   hover = small border/elevation change, no layout shift, reduced-motion respected; only interactive
   cards look clickable. Report summaries state what each number is, its currency and period;
   discrepancies emphasized with text + icon, never colour alone.
5. **Lead distribution — one stateful control** showing the current applied mode/status; options in
   its menu. Active = green, paused = neutral/amber, failure/blocked = red with the reason. Selecting
   an enabled mode saves and triggers distribution immediately (no second "Start"); scheduled modes
   show the next run; Pause stops future assignments. Saving/running state, then the server-confirmed
   assigned/pending result; empty employee pool and failures explained; no duplicate runs; existing
   ownership preserved. Verified against local demo leads (activation, pause, repeat, empty pool).
6. **Finishing touches** — consistent icons, refined surfaces, meaningful accents, short transitions,
   clear feedback; an extension of §12, not a new library or theme.

Pilot routes add `/store-orders/[id]` (tracker demo). Evidence: `tmp/pilot/r31-before` (= the
Round 3 pilot) vs `tmp/pilot/r31-after`, plus `tmp/pilot/distribution-test.md`.

### Round 4: final local polish — Microsoft Clarity reference (2026-09-28)

Bounded last UI round before returning to functional work. Keeps the Round 3.2 state (compact
sizing, type, navy/green identity, white light canvas, approved workflows). The Stripe/Linear
"SaaS overhaul" brief in `round4-proposal.md` is **not** adopted (owner: ignore it). Same gate: local
only, no merge / deploy / rollout until the owner approves the preview.

Reference: Microsoft Clarity (Microsoft's analytics product), official dashboard screenshots on
learn.microsoft.com (`clarity/insights/dashboard-features`) — no authenticated project was available.
Patterns taken: related metrics share one surface; label → figure → one context line; filter/segment
triggers are firm bordered controls with a chevron; restrained accents; soft 8–10px radii.

1. **Radius** one step softer via shared tokens only: `--radius-control` 6→8 (buttons, fields,
   triggers), `--radius-surface` 8→10 (cards, tables), `--radius-overlay` 10→12, menus 8→10,
   dialogs 12→14. `rounded-sm/md/lg` now resolve through these runtime tokens (design-system §12.10).
2. **Tactile controls** — solid actions: soft drop + faint top light; secondary buttons and dropdown
   triggers: firm `--input` edge + whisper depth; hover = fill + edge change; pressed/open = inset
   "sink" + darker fill (no movement, no resize); open trigger turns its chevron; keyboard focus =
   ring + halo. Segmented controls: recessed track, raised selected segment.
3. **Summaries** — `InsightGroup`: related static figures on one hairline-split surface (dashboard
   Leads / Orders; report figures), the reconciliation verdict stays its own card; tiles get the card
   whisper shadow. No added padding; report tables do not move down.

Evidence: `tmp/pilot/r4-before` vs `tmp/pilot/r4-after` (+ `r4-work/zoom-*` control states);
scripts `tmp/pilot/r4-capture.mjs`, `tmp/pilot/r4-zoom.mjs`.

## Round 4 rollout — the approved design becomes canonical (2026-09-28)

Owner approval received for the Round 4 local preview: adopt it as the canonical OMS design, roll
it out system-wide and release to Production. No new design direction.

- **Default for everyone:** `config/ui-pilot.ts`, `providers/ui-pilot-provider.tsx`, the top-bar
  switch, the `NEXT_PUBLIC_UI_PILOT` flag and the pre-paint script are removed. Geist + IBM Plex
  Sans Arabic load for every route.
- **Tokens folded:** pilot values now live in `app/globals.css` `:root` / `.dark` and
  `theme/tokens.css` (radius tiers 8 / 10 / 12, control, insight and form-card tokens);
  `theme/pilot-geist.css` → unscoped `theme/recipes.css`.
- **Classic retired:** every `useUiPilot().active` branch folded (pilot kept); classic-only code
  deleted (classic dashboard sections, lead header actions + plan, distribution header chips,
  store-order status strip, classic report summary strip and reconciliation card, classic document
  card layout). Presentational files renamed without "pilot" (`components/crm/*`,
  `dashboard-overview.tsx`, `document-editor-layout.tsx`, `control-states-board.tsx`).
- **Behavior preserved:** data, permissions, calculations and workflows unchanged; the approved
  Round 3.1 flows (Start follow-up folded into Add Follow-up, one stateful distribution control)
  are now the only flows. `scripts/production-operational-ux-e2e.mjs` checks the distribution
  control instead of the retired dialog.
- **Known leftovers:** `LeadDistributionModal` keeps a now-unreachable policy branch (always opened
  with `assignOnly`); `EnterpriseModal` accepts but no longer draws `icon`; the document editor no
  longer shows the `docCodePreview` placeholder number (shows «number on save»).

Evidence: `tmp/pilot/rollout-sweep` (every navigable route + editors + one detail page per module,
desktop and phone), independent review, gates and Production verification in `verification.md` /
`handoff.md`.
