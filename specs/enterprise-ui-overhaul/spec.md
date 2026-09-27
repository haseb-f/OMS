# Spec — Enterprise UI/UX Design System Overhaul

Milestone: `enterprise-ui-overhaul` · Status: **QUEUED** (received 2026-09-27)

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
