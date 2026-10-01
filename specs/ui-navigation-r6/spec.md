# Round 6 — Consolidated specification

Applies to BOTH the company workspace and the agent portal (`/agent/*`, roles Agent Admin = `agentRole
ADMIN`, Agent Sales = `SALES`). Visual consistency ≠ identical permissions: every summary, API, export,
print and drill-down is scoped **server-side**; restricted data is never sent to the browser.
Agents never see carrier costs, company margins, other agents' data, or internal setup.

Decision labels: **[R]** = integrator decision with recommended default (owner may override);
**[O]** = open owner decision (not blocking).

---

## SHIP — Converted leads do not appear in Shipping (Addendum §3) — release unit R6-1

### Findings (root cause)

1. `/shipping` (`ShippingController.findAll` → `StoreOrderShipmentsService.findAllFlat`) lists only
   `Shipment` rows. "Ready for shipping" = a Shipment row with `status = null` **or** an order at
   `shippingStage = READY_FOR_SHIPPING` with no Shipment row yet. Neither lead conversion
   (`WorkflowEngineService.executeLeadConvert`) nor direct creation (`StoreOrdersService.create`) nor a
   later full-payment declaration ever creates that row; it is created lazily only when an operator
   performs a shipment action from the order (`getOrCreateCurrent`). So eligible orders are invisible
   to the Shipping team. Affects conversion (internal + agent) and direct orders alike.
2. The web "Ready for Shipping" status filter sends `status=READY_FOR_SHIPPING`, which is not a
   `ShipmentStatus` enum value → DTO `@IsEnum` 400 → page shows "load failed".
3. Source filter offers only MANUAL/IMPORT; converted orders can be EXCEL / GOOGLE_SHEETS.
4. The gate (`evaluateFulfillmentGate`) itself is correct and stays unchanged.

### Requirements

- One idempotent server function (e.g. `StoreOrderShipmentsService.ensureQueued(storeOrderId, tx)`)
  that creates the first Shipment attempt (`status null`, attempt 1) **only if**: order not deleted,
  not cancelled, `fulfillmentMethod = SHIPPING`, order-level `shippingStage = READY_FOR_SHIPPING`
  (digital-only/pickup stay `NOT_READY`), the gate passes (COD always; PREPAID only with verified paid
  or a FULL paid declaration — partial/unpaid never), and no Shipment row exists. Concurrency-safe
  (row lock on the order or unique guard) — never two attempt-1 rows.
- Called inside the same transaction at: lead conversion (internal + agent), direct creation
  (internal + agent), payment declaration recompute (declared status becomes PAID), finance payment
  status sync (becomes PAID/OVERPAID), amendment that switches to SHIPPING or changes payment. Never
  calls carrier transitions; Finance verification and shipping execution stay separate.
- Cancelled orders: a `status null` attempt of a cancelled order must not show in the queue (filter
  by order status and/or soft-delete the untouched attempt on cancel — choose the one that preserves
  history; never delete an attempt that has a label/tracking/status).
- Queue API: `status=READY_FOR_SHIPPING` maps to `status: null`; add source options for every
  `StoreOrderSource` value; default filters must not hide newly ready orders.
- Blocked orders: the order detail shows a clear readiness/blocker message (reuse the gate reason;
  e.g. "Prepaid — awaiting full payment declaration") and, for users with `shipping.view`, a link to
  the order in the Shipping queue; conversion success feedback says "Sent to Shipping" or the blocker.
- Only internal Shipping (`shipping.*`) or authorized integrations execute transitions; agent tokens
  never reach `/shipping` (verify `JwtAuthGuard` default-deny).
- Repair: `apps/api/scripts/r6/repair-shipping-handoff.ts` — dry-run by default, lists orders that are
  eligible now and have no Shipment row; `--apply` calls `ensureQueued` per order, writes an audit
  activity per order (`SHIPPING_QUEUED_REPAIR`), idempotent, never touches payments/journals/history.
- Regression tests (real DB): conversion internal COD → in queue; agent conversion (internal
  fulfillment) prepaid full declaration → in queue; prepaid partial → blocked + not in queue, then
  declaration completes → in queue; pickup / digital-only / cancelled → never; idempotency (double
  call, concurrent); READY_FOR_SHIPPING filter returns the rows; agent token → 403 on `/shipping`.

---

## A — Navigation, settings & permissions — R6-2

### Findings

- Finance group (`navigation.config.ts:610+`) already has headings (`finance-operations / -ledger /
-assets / -setup`). Duplicate: `finance-general-ledger` → `/reports/finance?report=generalLedger`
  (same page as Reports › «التقارير المالية»). `finance-receiving-accounts` is a ComingSoon page.
- «المدفوعات / Payments» (`finance-supplier-payments`, `/purchasing/payments`) = **outgoing supplier
  payments**. Incoming store payments are `/finance/payment-review` («مراجعة المدفوعات») and
  `/finance/payment-reconciliation`.
- No roles: permissions are per user (`UserPermission`), catalog in `permission-catalog.ts`,
  `IMPLIED_SECTION_PERMISSION` derives `finance.view`/`settings.view`. Settings is gated by a single
  `settings.view/manage`; many settings pages have no route gate.
- Sidebar is already an accordion (one open) persisted in localStorage and auto-opens the active
  parent. Login: `/login?next=` keeps pathname only (query lost), `next` unvalidated; agents land on
  `/` then get redirected to `/agent`.

### Requirements

1. **Finance** (operational/accounting destinations only), headings:
   - Daily operations: Expenses «المصروفات» · Receipts «المقبوضات» (`/sales/payments`) · **Store
     Collections «تحصيلات المتجر»** (rename of `/finance/payment-review`, incoming) · Collection Review
     «مراجعة التحصيلات» (`/finance/payment-reconciliation`) · Transaction Matching «مطابقة العمليات»
     (`/finance/bank-transactions`) · Carrier reconciliation · **Supplier Payments «مدفوعات الموردين»**
     (outgoing, keeps `/purchasing/payments` — distinct, accurate name).
   - Ledger: Journal Entries · Chart of Accounts · Opening balances · Exchange rates (rates are daily
     data, not setup).
   - Assets & analytics: Cost Centers · Analytic Accounts and Plans (one entry with tabs or two
     adjacent entries) · Fixed Assets · Prepaid/Accrued expenses · Projects.
   - Remove `finance-general-ledger` (it lives in Financial Reports). Hide the ComingSoon
     `finance-receiving-accounts` entry. Keep every route/bookmark working (no route removed).
   - [R] Verify against route pages before final labels; the brief's mapping (Payments → Store
     Collections) applies only to the incoming page.
2. **Settings by domain** (headings, same heading mechanism as Finance): General (company, numbering,
   print, notifications, security, backup, users) · Finance (accounting settings/posting & account
   mappings, journals, payment methods, payment terms, payment sources, currencies, taxes, fiscal
   periods, year closing, cost-allocation rules) · Shipping (shipping companies, shipping statuses,
   fulfillment-cost rules / tariffs) · Costs (cost components) · Sales & CRM (classifications,
   no-purchase reasons, follow-up types, workflow statuses/transitions) · Integrations. Routes are
   unchanged; only the nav parent/heading changes. Using a configured method (e.g. choosing a payment
   method on a receipt) needs no settings permission.
3. **Granular permissions**: new catalog keys `settings.<domain>.view` / `settings.<domain>.manage`
   for `general, finance, shipping, costs, crm, integrations`. Enforce server-side on the setup
   controllers' **write** endpoints (manage) — existing granular keys (e.g. `masterdata.payment-methods.*`,
   `fiscal-configuration`, `numbering.manage`) keep working: the domain key is implied **in addition**
   (a user is allowed if they hold the existing granular key; new domain keys grant the domain's
   entries). [R] Implementation: extend `IMPLIED_SECTION_PERMISSION` and the guard's resolver so
   `settings.finance.manage` satisfies the finance setup actions, without granting other domains.
   Migration: users holding `settings.manage` → all `settings.*.manage`; users holding any existing
   granular setup key of a domain → that domain's `view` only (explicit mapping table in the migration;
   never all settings). Route gates on every settings page. Agents: never internal setup
   (`JwtAuthGuard` default-deny already; add a test).
4. **Sidebar & landing**: groups collapsed on a fresh session (do not auto-open from stale storage;
   the active route's parent still opens so the destination stays discoverable); one open at a time
   (already); login with no valid `next` → the user's authorized dashboard (internal `/`, agent
   `/agent`) directly (no bounce); keep `next` incl. query string, validate it as a same-origin
   relative path the user can access; preserve rounding/active styling. Agent label «لوحة الوكيل /
   Agent Dashboard» → «لوحة التحكم / Dashboard» (nav + page title), scope unchanged.
5. **Agent dashboard scope fix** (found during inspection): in OWN scope with `agent.statement.view`,
   `collections/position/payouts` still return whole-agent values (`agent-portal.service.ts:200-203`).
   Make OWN scope consistent (null or own-only — [R] null for agent-level money that cannot be
   attributed to a seller).
6. Deliver `navigation-map.md` (before/after tree + role-access matrix).

---

## B — Shared controls, notifications & tables — R6-2

### Findings

Toasts: sonner wrapper `components/ui/sonner.tsx`, top-center only on phones, top-left/right on
desktop; close button exists. Password: `PasswordFormField` (RHF) has Show/Hide; `profile/password`
and `user-editor-modal` use plain inputs. No shared copy control (only `generated-password-dialog` and
table double-click copy with silent failure). Table: `EnterpriseDataTable` already has custom
RTL-aware column resize (60–640px), per-column reset, localStorage prefs `oms.table.<id>.*`, selection
scopes page / all-matching / first N / clear. Print payload drops widths.

### Requirements

1. Password: a standalone `PasswordInput` (non-RHF) sharing the same internals as
   `PasswordFormField`; Show/Hide + **Copy** (copies the value currently typed, never fetches stored
   passwords); masked by default; paste allowed; correct `autocomplete`; no logging/persistence. Apply
   to login, reset, investor login/activate, profile/password, user-editor create.
2. `CopyButton` + `useCopyToClipboard` in `components/shared/`: copies the full value; checkmark +
   «تم النسخ / Copied» only after success (sr-only live region too); accessible failure toast. Use in
   `SemanticValue` for `phone`/`id`/reference kinds (opt-in prop `copyable`), table `phone`/
   `reference` column types, order/lead/receipt detail headers (reference numbers), agent screens.
   Replace the ad-hoc implementations (generated-password dialog, table double-click → shared hook,
   with failure feedback).
3. Notifications: TOP CENTER on desktop and mobile; visible × close (≥ 24px hit area, labelled);
   success check / failure treatments; readable width; stacking (expand on hover, max visible 3);
   toaster never creates a full-screen layer that blocks clicks; inline field errors unchanged.
4. Resizable columns: keep the engine; add: visible handle on hover/focus (keyboard: ←/→ when the
   handle is focused), double-click handle = auto-fit to content (measure header + visible cells,
   clamp min/max), "Reset column widths" in the view menu, preference per user per table — key
   `oms.table.<userId>.<tableId>.columnWidths` with migration from the old key; resize must not trigger
   sort (pointer events stop propagation) or selection. Mobile card mode untouched. Print uses its own
   widths (`PrintColumn.width` honoured by the list template; derive from column type, never from
   screen preferences).
5. Selection: verify page / all-filtered / first-N (deterministic current sort + id tie-break on the
   server) / clear; visible count + scope; bulk partial-failure feedback (shared summary: "x succeeded,
   y failed" with reasons). Mobile card mode supports selection. Agent tables: bulk actions limited to
   permitted records server-side (verify the agent bulk endpoints scope by agent/owner).

---

## C — Leads & distribution — R6-2

### Findings

Follow-ups capture `outcome` («نتيجة التواصل»: answered, noAnswer, interested, callback,
wrongNumber, notInterested — front-end list only). `Lead.customerClassificationId` (only rows:
RETAIL «تجزئة» / WHOLESALE «جملة») is the Retail/Wholesale control on lead screens (list column +
filter + detail combobox). Distribution: modes CONTINUOUS / TIME_LIMITED (24h) / MANUAL / PAUSED, drain
with advisory locks, agent leads excluded, no cron. UI = dropdown menu `lead-distribution-menu.tsx`.

### Requirements

1. **Follow-up classification** = the follow-up outcome. [R] Server-owned closed list (validate in
   DTO; same 6 codes). `Lead.followUpOutcome` + `followUpOutcomeAt` = authoritative current value;
   history stays in `LeadFollowUp` rows. Rule: a new follow-up **with** an outcome replaces the current
   value if its `completedAt/createdAt` is the latest; a follow-up without outcome leaves it unchanged;
   deleting is not possible (follow-ups are append-only). Backfill from the latest follow-up with an
   outcome. Show as a badge column in the internal lead list, in the detail header/field, filter
   (`followUpOutcomes`), export column. Agent lead screens: show the same read-only value where the
   lead has follow-ups (agents have no follow-up feature — no new agent capability).
2. Remove the Retail/Wholesale (customer classification) control, column and filter from lead
   screens. Keep the column/data, the master-data page and API fields (no deletion).
3. **Distribution control**: solid status button (green active · amber paused/manual · red
   blocked/error) with text, pending count. Click → compact dialog (`EnterpriseModal`, soft glass
   surface via tokens): modes with one-line explanations, current mode + eligibility (eligible
   employee count, held/pending counts, team scope), Confirm/Cancel. Selecting previews only; Confirm
   saves and immediately runs the drain for CONTINUOUS / TIME_LIMITED and shows the actual result
   (assigned n, held m, failure reason with action link); MANUAL/PAUSED show "no automatic assignment".
   TIME_LIMITED shows "active until <time>" (no scheduler exists — never claim a scheduled run).
   Cancel = no request. Loading state, button disabled while running, server lock already prevents
   duplicates; owned leads are never reassigned. Only `crm.leads.manage`. Agent leads never enter the
   internal pool (existing `agentId: null` filters — add a regression test).

---

## D — Report numbers & printing — R6-2

### Findings

`lib/money.ts` formatter; `ReportMoney` shows zero as muted «—»; null → `toNumber` → 0 (missing shown
as zero); Dr/Cr labels appended on screen (`DrCrSlot`), summary cards, print/CSV
(`financial-report-export.ts`, `summary-format.ts`); trial balance + ledger use `drcr`. Print period
is "a – b" without From/To; as-of OK; printed-at timestamp uses browser zone. Agent statement uses
`formatMoney`.

### Requirements

1. Genuine zero → `0` at the report's precision (e.g. `0.00`), not «—». Missing/unavailable → «—»
   (or blank where the column semantics demand) — never 0. Fix `toNumber` callers so null stays null.
2. Remove the repetitive «مدين/دائن» suffix beside balances where Debit/Credit columns or sign already
   explain it (trial balance, ledger running balance, summary cards); keep Debit/Credit columns.
   Negative balances: red (`--destructive` text token, print = black) + minus sign. Do not change any
   calculation or sign convention; exports keep raw numeric values.
3. Print: description/narration column gets a reasonable minimum width and wraps by words
   (`overflow-wrap: break-word`, not `anywhere`); header shows `From / من 01 Oct 2026 · To / إلى 31 Oct
2026`, or `As of / كما في 01 Oct 2026` for point-in-time reports (no invented ranges). Dates are
   business dates (Africa/Cairo) via `business-date.ts`; printed-at uses Cairo too.
4. Agent statement/commission prints and CSV use the same formatter; verify no cost/margin/other-agent
   data (server audience `PORTAL`).
5. Evidence: actual PDF output (Playwright `page.pdf()` of the print route) for a long report and an
   agent statement — check clipping, page growth, repeated headers.

---

## E — Visual: dashboards, report summary cards, dropdown trial — R6-3 (owner approval)

Base: `feat/r5-visual` (spec-4: soft surfaces, report collapse, toolbars) merged with `main`.

1. Microsoft Clarity reference direction: white light canvas; soft glass-like cards = subtle tinted
   gradient surface + hairline translucent border + moderate radius (`--radius-surface`), no blur
   stacks, no heavy colour blocks. Semantic families: blue = new/activity, green/teal =
   conversion/delivery success, amber = pending/follow-up, red = overdue/error, neutral otherwise.
   Colour follows meaning only.
2. Metric cards (`InsightCard`/`InsightGroup`): label (concise, never truncated), prominent value,
   essential context only; period/scope moved to the group header; "current state" vs "in period"
   groups labelled. Interactive cards/rows: hover/focus = border + shadow, no layout shift; static
   cards have no hover. Reduced motion, dark-mode equivalents, contrast check script passes.
3. Supporting panels (attention, ranking, bank matching): refined separators, icon/colour accents,
   count/action hierarchy; zero/resolved states compact; current-user emphasis restrained.
4. **Agent dashboards**: `/agent` re-composed from the same `InsightGroup`/`InsightCard`/
   `DashboardPanel` (replace bespoke `KpiCard` usage) with the existing scoped endpoint. Agent Admin:
   sales, fulfillment, collections, statement position, payouts. Agent Sales: own leads/orders/
   follow-up and fulfillment progress — no money blocks (server already returns null). No company
   panels.
5. **Report summary cards** (financial reports + agent statement/commission summaries): same soft
   treatment, compact (rows stay high on screen), collapse + discrepancy indicators preserved; print
   is plain.
6. **Dropdown trial** (canonical components only, behind a local trial switch that is **not**
   deployed system-wide): A = solid deep brand-navy trigger (`--primary`) with white text/icons;
   B = restrained alternative (white trigger, 1.5px navy-tinted border, navy text weight 500, navy
   chevron chip) with equal weight. States: placeholder, selected, hover, open, pressed, focus,
   disabled; status-specific selects keep semantic colours; primary submit buttons stay
   distinguishable (A must not look like a primary button — e.g. different radius/chevron chip and no
   bold label). Render both on: a list filter toolbar, a form, a dialog, a financial report filter
   bar — AR/EN, light/dark. Recommend one with reasoning.
7. Deliver before/after screenshots (company dashboard, Agent Admin, Agent Sales, a financial report,
   dropdown A/B) under `docs/user-guide/evidence/r6-visual-20261001/`.

---

## Verification matrix (integrator, one browser pass per release unit)

Roles: internal Admin; internal Sales; internal Shipping; internal Finance; Agent Admin and Agent
Sales of agent X; Agent Admin of agent Y (cross-agent isolation). AR/EN, RTL/LTR, light/dark,
1440/390. Shared metrics for the same agent + filters must agree between internal agent views and
the agent portal; restricted fields absent from API responses (checked via network payloads).
