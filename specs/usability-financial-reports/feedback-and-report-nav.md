# UI-C — Feedback (notifications) and financial report navigation

Stream UI-C of `spec.md`. Status: implemented 2026-09-29; typecheck/lint/tests green (see Verification).

## §3 Financial report selector hierarchy

Component: `apps/web/src/components/accounting/financial-report/report-switcher.tsx` (extracted from
`financial-report-header.tsx`, which now only re-exports it — no API change for callers).

- **Hierarchy.** Root title «التقارير المالية / Financial reports» (non-selectable header row, bottom
  hairline) → group headings → indented report rows. Group order on `/reports/finance`:
  1. Ledgers & entries (الدفاتر والقيود) — General ledger, Trial balance, Journal, Account statement
  2. Financial statements (القوائم المالية) — Balance sheet, Income statement, Cash flow
  3. Receivables & payables (الذمم المدينة والدائنة) — AR aging, AP aging, Customer / Supplier statement
  4. Cash (النقدية) — Cash availability. Kept as its own last group: it is an operational cash-position
     view, not a financial statement, so it does not dilute the statements group.
- **Headings** are cmdk group headings (`cmdk-group-heading`, `aria-hidden`, labelling a `role="group"`),
  so they are never options and never keyboard-reachable. Styled as compact caption/semibold/muted
  labels with a hairline separator between groups — not like report rows.
- **Children** are indented with logical padding (`ps-5`) — correct in RTL and LTR.
- **Active report:** trailing check + `--primary-soft` selected surface + medium weight
  (`data-checked`), `aria-current="true"`, and it is the initially highlighted row
  (`Command defaultValue`, so `aria-selected`) and scrolled into view on open.
- **Not collapsible** — 12 reports fit one bounded list (max 26rem / available height), so every group
  is always expanded and the active report is always revealed. No extra click.
- **Keyboard:** shared `Command` primitive — ↑/↓ (looping), Home/End, Enter, Esc (Radix popover),
  type-to-filter via the search field (matches the translated label through cmdk `keywords`;
  empty groups and separators hide while filtering). Trigger `aria-haspopup="dialog"`.
- i18n: `reports.finance.header.groups.root` added; `ledgers` (en) → "Ledgers & entries";
  `partners` (ar) → «الذمم المدينة والدائنة».

## §5 Success / error feedback

Shared: `lib/toast.ts` (semantics + helpers), `components/ui/sonner.tsx` (Toaster), tokens in
`app/globals.css` (`--toast-{success,destructive}-{surface,border,edge,title}`, light + dark) and
`theme/tokens.css` (`--toast-width`, `--toast-offset-top`, `--toast-offset-inline`); styles in the
"Global Feedback System" block of `globals.css`.

| Tone                                                   | Visual                                                                                                  | Announce                                | Default duration                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| success                                                | success-soft surface, stronger green ring, 3px start-edge accent, green semibold title, 20px check icon | `role="status"` polite                  | 5s                                                                               |
| error (failed save / load / action)                    | destructive-soft surface, red ring + edge + title, octagon-X icon, close button                         | `role="alert"` assertive                | 10s; **persistent** with `onRetry` (adds «إعادة المحاولة / Retry») or `critical` |
| destructive (confirmed + server-completed cancel/void) | same red treatment, `Ban` icon                                                                          | `role="status"` polite (nothing failed) | 6s                                                                               |
| warning / info                                         | unchanged quiet solid card + tinted ring                                                                | polite                                  | 7s / 5s                                                                          |

- **Live regions:** sonner exposes one polite region; each toast title is wrapped in its own live
  region, so the nearest-ancestor politeness applies (errors interrupt, the rest waits). Region and
  close-button labels are localized (`toast.region`, `toast.close`).
- **Size/hierarchy:** card 384px (was 356), 14px/16px padding, 14px semibold title, 13px description
  in body color, radius `--radius-md`, `--shadow-floating`.
- **Placement:** stays at the top per design-system §11.4, but now offset _below_ the 48px top bar
  (never over search/notifications/account) and away from bottom action bars and sticky modal footers;
  logical end corner on desktop, centered full-width on phones with `env(safe-area-inset-top)`.
  Bottom-end was considered and rejected: it collides with the phone document action bar and sticky
  modal footers.
- **Contrast:** toast pairs added to `scripts/design/contrast-check.mjs` (title, body, accent edge,
  ring × light/dark) — all pass (min 4.27:1 edge vs 3:1, titles ≥ 5.56:1).
- **Dismissal vs failure vs destructive:** closing an unchanged form or pressing Esc shows nothing;
  a dirty form asks through the shared EnterpriseModal discard confirmation (no toast); a failed save
  is red/assertive with inline `FormErrorSummary` unchanged; a confirmed destructive completion uses
  `reportDestructiveDone`.

### Call sites changed

- Optimistic/unsafe success fixed (success shown even when requests failed — rejections were swallowed):
  `components/master-data/master-data-page.tsx` (bulk archive fallback loop),
  `app/(shell)/products/page.tsx` (bulk archive) → `Promise.allSettled`, error toast with the failed
  count, success only when all were confirmed.
- Dismissal toast removed: `components/crm/lead-distribution-modal.tsx` — Close with an unsaved policy
  change used to close silently and show «Changes were not saved»; now `isDirty` drives the shared
  discard confirmation, unchanged close shows nothing, and a successful save closes directly.
- Confirmed document cancellations → `reportDestructiveDone` (red, polite): sales orders, quotations,
  invoices, returns, payments (receipts); purchase orders, quotations, invoices, returns, payments
  (list pages under `app/(shell)/{sales,purchasing}/*/page.tsx`); physical count
  (`inventory/physical-count/count-detail-dialog.tsx`).
- Audit found no other success toast fired before its awaited mutation (the remaining heuristic hits
  were `if/else` branches, each toasting after its own await).

## Verification

- `pnpm typecheck` ✓, `pnpm lint` ✓ (0 errors; 9 pre-existing warnings in files outside UI-C).
- `pnpm test`: 445/446 on the full run; the one failure (`enterprise-data-table.layout.spec.tsx`
  sort test, 5.4s timeout, UI-A) passes 3/3 in isolation — load flake, outside UI-C.
- New tests: `lib/toast-semantics.spec.ts` (tone → role/aria-live/duration/close, Retry/critical
  persistence, destructive-done not an error, wrapper output), `report-switcher.spec.tsx` (grouping,
  headings/root not options, active report check + aria-current + highlighted, revealed, ↓ + Enter).
- `node scripts/design/contrast-check.mjs` ✓ all pairs.

## Open points

- Investor cancellations (`investors/opportunities/*`, `capital-returns-section.tsx`) toast a generic
  «تم الحفظ / Saved» after `cancel(...)`; they could move to `reportDestructiveDone` with a specific
  message (needs new copy per operation).
- Import-job cancel (`import-center`, `shipping/import`, `store-orders/import`) keeps a success toast —
  it stops a process rather than voiding a document.
- `reportApiError(..., { onRetry })` is available; no call site adopts Retry yet (each needs its own
  idempotency review).
- No browser pass was run (per brief); visual check of the toast card and the switcher in RTL/LTR and
  dark mode belongs to the master verification pass.
