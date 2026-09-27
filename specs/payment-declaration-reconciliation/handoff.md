# Handoff — payment-declaration-reconciliation

**Status: COMPLETE.** Every acceptance criterion is verified on Production, except the Google Sheets
connection inside C3, which is **BLOCKED** until a sheet is shared with the service account. Details
are in `verification.md`.

- Releases:
  - 00109b0 foundation
  - 349e599 period last-day fix
  - 6636a6d feature and review fixes
  - 5cf2daa acceptance findings
  - 0331a58 product picker SKU
  - a final commit: Arabic-first FX and matching messages, the guide and the evidence
- The final SHA is verified as HEAD = origin/main = Production, and reported in the session summary
  and in the git log. It is not repeated here, because recording it would change it.
- Production acceptance: RUN DEMO-PDR-20260927 on 0331a58, run by the Master with owner approval.
  Evidence is in `docs/user-guide/evidence/PAYMENT-RECON-20260927/`, screenshots in
  `docs/user-guide/screenshots/payments/`. The tagged demo data is kept as the guide dataset
  (`docs/user-guide/demo-records.md`).
- Arabic guide: roles/sales-agent, sales-manager, shipping, finance and super-admin, plus workflows,
  reports, coverage, issues, demo-records, screenshot-index and README.

Owner actions (not blocking):

1. Share a Google Sheet with oms-google-sheets@muhbara-system-495000.iam.gserviceaccount.com to verify
   sheet sync.
2. Link a clearing (ASSET) account and turn on "Requires reconciliation" on the real provider methods
   (تمارا، Mamo Pay, …) before using them in reconciliation.
3. The FX rate basis defaults to a derived MID (buy/sell are stored). It can be changed in FX settings.

Known limitations are listed in `verification.md` (L2, L4, L6, L9, L10, M3 notes).

Only tested automatically, not in the Production browser run:

- Sheets sync and source exceptions
- Correcting a match
- Reversing a settlement, and partial settlement
- Blocking a method account change (L3)
- The last-day period lock
- FX columns in reports

Next milestone: `specs/enterprise-ui-overhaul/`, owned by the "OMS enterprise UI/UX design system
overhaul" session. It starts after this handoff (the owner's instruction).
