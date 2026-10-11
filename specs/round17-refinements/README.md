# R17 — refinements (owner brief 2026-10-11)

Integration branch `integration/r17`. Deployment process (agreed R16): local preview + before/after screenshots →
owner visual approval → fast-forward `main` (Vercel Production) → read-only Production smoke.

| Stream | Items                                                                        | Branch / worktree                   | Demo DB     |
| ------ | ---------------------------------------------------------------------------- | ----------------------------------- | ----------- |
| A      | 2 editable versioned agent agreements, 3 shipping rates + COD collection fee | `feat/r17-agreements` / `OMS-r17-a` | `oms_r17_a` |
| B      | 1 unopened-lead indicator, 4 unified report cards, 5 login fields −4 px      | `feat/r17-ui` / `OMS-r17-b`         | `oms_r17_b` |

## 1. Unopened lead indicator (B)

Existing definition kept: `isNewToViewer` (per-viewer `viewedByMe`, set only when the viewer opens the lead —
never by a row/card appearing in a list). Make `LeadNewToYouMarker` prominent in table AND grid: semantic info
(blue) badge with dot/icon + text «لم يُفتح» / "Unopened", AA contrast light/dark; opened rows/cards get no
marker (optionally a muted "opened" state is NOT added — absence is the opened state). Unopened table rows get a
start-edge accent; grid cards get the same badge in the header. No colour-only meaning.

## 2. Editable, versioned agent agreements (A)

Applies to the commission agreement (`AgentAgreement`) and the shipping agreement (`AgentShippingAgreement`).

- "Edit" on an ACTIVE agreement (permission `agents.agreements.manage` — reuse the existing agreement-management
  key; API + UI) creates a NEW VERSION (copy + changes) that becomes active at the save instant; the previous
  version is closed at that same instant (`activeTo`) and kept read-only with its full content. Version chain:
  `supersedesId` / `versionNumber`; audit entry (who, when, field diff) via `MasterDataActivityLog`.
- Instant precision: add `activeFrom` / `activeTo` timestamps (existing day-dated `effectiveFrom/To` stay for
  planned future versions). Resolution at an instant: the version with `activeFrom ≤ t < activeTo` (or the
  day-dated one when no instant bounds apply). Never two versions in force at the same instant (validated).
- **Charge-assessment event = order submission** (unchanged R15 rule: the agent shipping charge and commission
  terms are frozen into the order's terms snapshot when the order is created; channel confirmation only picks
  among the frozen per-channel charges). New orders after the save use the new version; orders already
  submitted keep their snapshot — no repricing of orders, shipments, ledger or settlements. A later
  payment-type/service change on an existing order goes through the existing audited amendment flow, which
  re-assesses against the version in force at the order's original assessment (its snapshot), never silently.
- UI text on the edit dialog: «يسري التعديل من لحظة الحفظ على الطلبات الجديدة فقط؛ الطلبات المُسجلة سابقًا تحتفظ
  بالرسوم والعمولة المحسوبة عند إنشائها.» + English; version history list with dates.

## 3. Shipping rates + COD collection fee (A) — extends `AgentShippingAgreement`

- Default rate: one row for all services + all destinations (`service = ANY`), required for a new agreement
  created through the simple form.
- Optional additional rates ("Add rate"): service (existing 4 services) and/or destination (country / city),
  each with an amount.
- COD collection fee (optional, fixed, agreement currency): `codCollectionFee`.
- Each rate row carries `codFee`: `ADDED` (COD orders pay row amount + fee) or `INCLUDED` (row amount is
  all-inclusive). Existing COD-service rows are migrated as `INCLUDED` (never charged again); `ANY`/prepaid rows
  are `ADDED`. Prepaid never pays the fee.
- Resolution (unambiguous): most specific destination first (city → country → all); at the same destination a
  service-specific row beats `ANY`. Duplicates (same service × destination) are rejected; the default row is the
  final fallback. Missing default + no match → existing "tariff missing" error.
- Snapshot per channel at submission: `{ base, codFee, codFeeMode: ADDED|INCLUDED|NONE, amount }` — `amount` is
  what the ledger/commission flows already use, so customer-shipping retention and agent deductions keep their
  approved treatment. Agent tariff only — never carrier cost or internal margin.
- Form: compact — default rate first, "إضافة سعر" for extra rows, a clearly labelled COD fee field, and a live
  preview: «مدفوع مسبقًا: 25 ر.س — الدفع عند الاستلام: 25 + 10 = 35 ر.س» (and «شامل رسوم التحصيل» on INCLUDED rows).
- Example acceptance: base 25 SAR, COD fee 10 → prepaid 25, COD 35; an INCLUDED COD row of 35 → COD 35 (not 45).

## 4. Unified report cards (B)

One shared component/tokens (R16 `InsightSurface`) for every report summary card: agent screens/reports,
company-partner screens/reports, dashboards, financial/sales report summaries, import summaries, inventory
integrity. Semantic tone colours clearly visible; soft surface; readable title, prominent figure; animated hover
(subtle elevation via shadow, stronger border/tint) with short transitions, no layout shift; identical
`:focus-visible` for actionable cards; informational cards are not focusable and show no pointer/chevron;
`prefers-reduced-motion` → no transition; `hover: none` → clear resting state. Record-grid status cards untouched.
Audit every consumer; list them in the progress log.

## 5. Login fields −4 px (B)

`--auth-control-height` 50 → 46 px (submit too); keep 16 px text, padding, reveal/hide, no copy icon.

## Verification

Unit/integration tests per stream; API journeys for agreements/COD (numeric example below must be proven);
one browser pass (ar/en, light/dark, desktop/390 px, keyboard focus, reduced motion); before/after screenshots.

Numeric example to prove (stream A): agent shipping v1 base 25 SAR, COD fee 10. Order O1 (COD) at t1 → 35.
Edit at t2: base 30, COD fee 12 (v2). O1 still 35 (snapshot); order O2 (COD) at t3 > t2 → 42; O3 prepaid → 30.
