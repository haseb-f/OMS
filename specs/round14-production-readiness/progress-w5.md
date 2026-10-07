# W5 progress — company partners and profit sharing ("الشركاء")

Branch `feat/r14-partners`, worktree `D:/Systems/OMS-r14-w5`, DB `oms_r14_w5`. Newest first.

## 2026-10-07 — implementation complete (local)

Commits: `5e210141` schema + migration · `354b1a5d` API · `87bf54b2` web (+ API candidates endpoint) · this log.

### Delivered

- **API** `apps/api/src/company-partners/**`: profiles (`/company-partners/profiles`, existing Partner gains OWNER
  or a new Partner is created; `candidates` picker), agreements (`/agreements`: create → ACTIVE by default, DRAFT edit,
  `end`, `supersede`; rules: one agreement per partner per day, Σ% of in-force agreements ≤ 100 on every day, one
  frequency for ACTIVE agreements, no change reaching a CLOSED period), periods (`/periods/preview` live estimate,
  `POST /periods` save/refresh review with snapshot, `close`, `adjustments`), payments (`/payments`, `reverse`),
  statement (`/profiles/:id/statement`). Calculator `partner-profit-calculator.ts` (pure).
- **Posting** `accounting/posting-providers/company-partner-posting.provider.ts` (registered by `CompanyPartnersModule`):
  `PARTNER_PROFIT_DISTRIBUTION` (Dr distribution equity / Cr payable per partner, dated period end),
  `PARTNER_PROFIT_ADJUSTMENT` (delta only), `PARTNER_PROFIT_PAYMENT` (Dr payable / Cr cash-bank). Accounts via
  `AccountMappingService.resolvePartnerProfit*` + type check (EQUITY / LIABILITY); actionable
  `PARTNER_ACCOUNTS_NOT_CONFIGURED` when unset. Settings: two columns validated (type, postable) and locked after the
  first partner posting (`PARTNER_ACCOUNTS_LOCKED`).
- **Web**: `/company-partners` (summary cards, Table/Grid list, add-partner dialog with optional first agreement),
  `/company-partners/[partnerId]` (range statement: estimate «تقديري» vs approved, paid, payable/advance, profit used
  summary, tabs segments / approved periods / agreements / payments, drill-down to income statement and journal entries),
  `/company-partners/periods` (preview → save review → close → adjust), payment + reverse dialogs; nav «الشركاء» under
  Finance › operations + `home.destinations` lines; Settings → Accounting section; i18n en + ar; journal source labels.

### Verification

- API `tsc` clean; ESLint clean on changed files; `jest --runInBand src/company-partners` → 2 suites, 15 tests pass
  (5 unit + 10 real-DB integration; fixtures in 2035, everything cleaned up afterwards, settings restored).
  Regression: `src/permissions`, `src/accounting/posting-engine`, partner catalog scope → 10 suites / 438 pass.
- Web `tsc` clean; ESLint clean on changed files; full `vitest run` → 141 files / 1006 tests pass.
- Integration covers: gross/net from a seeded ledger (revenue 100 000, COGS 55 000, expenses 25 000 → gross 45 000,
  net 20 000); B2B + online invoice counted once (receipt adds nothing); segment split A 30 %→40 % on 16 March = 7 200,
  B 4 000; loss month → 0; Σ% 110 rejected; frequency mismatch rejected; active agreement edit refused; close without
  accounts → actionable error; settings refuse a revenue account; close → one balanced JE on EQUITY/LIABILITY only,
  partner-dimensioned credits; close twice → 409, re-review of closed → 409, engine re-post idempotent; payment →
  payable 2 200; overpayment → advance 800 (GL −800); reversal restores 2 200; adjustment posts +400 / +200 only,
  snapshot unchanged, repeat → "no difference"; stale review → 409; statement totals.
- **Mutation proof**: loss clamp disabled (`const clamped = false`) → "a loss month yields 0 entitlement" fails
  (received `[-2000, -1000]`, expected `[0, 0]`); restored → passes.

### Deviations from the spec text

- Added `PartnerProfitAdjustment` (one row per correction run = one posting source id; entitlements link to it).
- `PartnerEntitlement` also stores `segmentFrom/segmentTo`; review rows of a PREVIEW period are replaced on refresh.
- Payables / advances are computed from the posted documents (closed entitlements − non-reversed payments), which equal
  the partner balance of the payable account by construction.
- `GET /company-partners/profiles/candidates` (manage) so adding a partner does not depend on `partners.*` grants.

### Accounting policy points not inferable — default implemented, owner to confirm

1. **Loss carry-forward (D5-1, open)** — default: not carried. Jan net −5 000, Feb net +20 000, A 30 % → Feb 6 000
   (carry-forward alternative: (20 000 − 5 000) × 30 % = 4 500).
2. **Loss rule per segment, segments per partner** — a partner's period is split only by its own agreement dates, and
   each segment is clamped separately. A 30 %→40 % on 16 Mar, 1–15 net −2 000, 16–31 net +12 000 → A = 0 + 4 800 =
   4 800 (netting alternative: −2 000 × 30 % + 12 000 × 40 % = 4 200). Recommended: keep (spec wording "segment/period").
3. **Rounding residue** stays with the company: three partners at 33.3333 % of 100.00 → 33.33 each, 0.01 retained.
4. **Retroactive agreement changes** into a closed period are refused; adjustments only follow ledger changes.
   Recommended: keep; a retroactive deal change would need an owner-approved adjustment with a stated reason.
5. **Adjustment entry date** = the day it is posted (current open period), not the closed period's end. Example: March
   closed (7 200 for A); a late March invoice adds 1 000 → +400 posted on the adjustment date.
6. **Close requires the reviewed figures to equal the live ledger** (`PARTNER_PERIOD_STALE` → refresh the review).
7. **Payments** may be made from any postable ASSET account; overpayment is allowed and shown as an advance, netted
   automatically against later approved profit (payable = approved − paid). No withholding tax / zakat is deducted.
8. **Close entry date** = period end; if that accounting period is closed the engine refuses (reopen or choose
   policy). An INACTIVE partner still receives the share of an agreement in force.

### Open issues

- No browser pass done (per brief). Print layout for the partner statement not built (uses table print).
- Pre-existing schema drift on `prepaid_expenses_receiving_account_id_fkey` (not W5) excluded from the migration.
