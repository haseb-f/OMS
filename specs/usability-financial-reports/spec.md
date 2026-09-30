# Usability refinements & financial report correctness

Status: **released** — `f75db61`, `19f34b2` (Production-verified, `verification.md`); completion items (toast ×, selection scopes, cross-page bulk actions, phone selection) released in `8a67de9`/`61a5124`, verified on Production 2026-09-30 (`specs/cross-session-completion/register.md`). Open owner points P4–P12 only (`specs/cross-session-completion/decisions-ar.md`). Originally started 2026-09-29. Owner brief: "OMS — USABILITY REFINEMENTS & FINANCIAL REPORT CORRECTNESS".
Design baseline: `specs/enterprise-ui-overhaul/design-system.md` §12 (approved Round 3/4). The rejected
`round4-proposal.md` is NOT an input.

## Workstreams and file ownership

Work is split so no two streams edit the same component. Shared i18n files
(`apps/web/src/i18n/messages/{ar,en}.ts`) are edited by all streams with targeted edits only, each in
its own key namespace.

| Stream                     | Scope                                   | Owns                                                                                                                                                              |
| -------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-A Tables                | §1 bulk selection, §6 table surfaces    | `components/shared/data-table/*`, `components/ui/{table,checkbox}.tsx`, table tokens/recipes, store-orders + customers list wiring                                |
| UI-B Phone                 | §2 country-aware phone                  | `services/phone-service.ts`, `components/shared/phone-*.tsx`, `form-fields/phone-field.tsx`, lead/order/customer form phone groups, `apps/api/src/common/phone/*` |
| UI-C Feedback + report nav | §3 selector hierarchy, §5 notifications | `lib/toast.ts`, `components/ui/sonner.tsx`, toast tokens, `ReportSwitcher`, `reports/finance/page.tsx`                                                            |
| ACC Accounting review      | §4 report calculations                  | `apps/api/src/accounting/reports/*`, report tabs (`reports/finance/*-tab.tsx` except `page.tsx`), `financial-report/*` except `ReportSwitcher`                    |

Independent reviewers (read-only) cover: financial calculations (ACC) and permission-sensitive bulk
actions (UI-A).

## Requirements

The owner brief is the requirement text; each stream records its design decisions, policy
assumptions and evidence in its own section file:

- `tables-selection.md` — UI-A
- `phone-field.md` — UI-B
- `feedback-and-report-nav.md` — UI-C
- `accounting-review.md` — ACC (framework, policies, per-report findings, fixes, tests, open policy points)
- `verification.md` — master: commands, browser evidence, reconciliation evidence, release SHA

## Invariants (all streams)

- Never rewrite historical postings to force reconciliation; no destructive bulk data normalization.
- EGP is the base (functional) currency; presentation-currency amounts are labelled as equivalents.
- No success feedback before the server confirms.
- Tokens only (no hardcoded colors), logical properties (RTL), dark mode deliberate, no horizontal page scroll.
- Financial reports are never described as "compliant" or "verified" without test/reconciliation evidence.
