# Chief Accountant Guardian

Owns 100% of OMS Accounting Logic. Every Accounting task MUST load this
Guardian. If accounting rules are violated, the task is NOT complete.

Reference: IFRS, ERP Best Practices, Odoo Accounting Workflow (business
logic only).

==========================================================
Accounting Philosophy
==========================================================

- Double Entry Accounting.
- Accrual Basis.
- Perpetual Inventory.
- Moving Average Cost.
- Real-time Posting.
- Single Source of Truth.
- Every document must have accounting meaning.
- No fake accounting.

==========================================================
Source of Truth
==========================================================

- Posting Engine
- Inventory Engine
- Matching Engine
- Journal Engine
- Financial Reports

Nothing else.

==========================================================
Document Flow
==========================================================

Sales: Quotation → Order → Invoice → Customer Receipt → Return (Invoice
Only).

Purchasing: Quotation → Order → Invoice → Supplier Payment → Return
(Invoice Only).

- Returns MUST always reference the original invoice.

==========================================================
Posting Rules
==========================================================

- Automatic Posting only.
- Posting Engine creates Journal Entries.
- Never create Journal Entries manually.
- Every posting balanced.
- Every posting auditable.
- Every posting linked to Source Document.

==========================================================
Inventory
==========================================================

- Perpetual Inventory.
- Moving Average Cost.
- Inventory is updated automatically.
- Inventory creates accounting automatically.
- Returns reverse inventory correctly.
- COGS calculated automatically.
- Never manual inventory posting.

==========================================================
Sales
==========================================================

- Invoice creates Revenue.
- Invoice creates Customer Receivable.
- Invoice decreases Inventory.
- Invoice records COGS.
- Receipt never creates Revenue.
- Receipt only reduces Receivable.

==========================================================
Purchasing
==========================================================

- Purchase Invoice creates Payable.
- Purchase Invoice increases Inventory.
- Supplier Payment reduces Payable.

==========================================================
Payments
==========================================================

Types: Customer Receipt, Supplier Payment, Manual Receipt Voucher, Manual
Payment Voucher.

Supported: Allocation, Partial Allocation, Multiple Invoice Allocation,
Advance Payment, Overpayment, Unallocated Balance.

- Matching Engine only.

==========================================================
VAT
==========================================================

- Tax is OPTIONAL.
- Line level.
- Document may contain taxable and non-taxable lines.
- No VAT Journal if tax empty.
- Reports handle both correctly.
- Never force tax selection.

==========================================================
Chart of Accounts
==========================================================

- Hierarchy.
- Parent / Child.
- Account Types.
- Control Accounts.
- Allow Reconciliation.
- Currency.
- Inactive.
- No cycles.

==========================================================
Journals
==========================================================

- Types: Sales, Purchase, Cash, Bank, General.
- Auto selected by Posting Engine.
- Manual Entries require Journal.

==========================================================
Journal Entries
==========================================================

- States: Draft, Post, Reverse, Archive.
- Immutable after posting.
- Balanced only.
- Closed periods blocked.

==========================================================
Accounting Periods
==========================================================

- States: Open, Close, Lock, Reopen.
- No posting into closed periods.

==========================================================
Fiscal Year
==========================================================

- Opening Balance Wizard.
- Closing Entry.
- Retained Earnings.
- Opening Next Year.
- One Opening per Fiscal Year.

==========================================================
Matching
==========================================================

- Receipts allocate invoices.
- Payments allocate invoices.
- Partial Allocation.
- Full Allocation.
- Advance Allocation.
- Outstanding Balance.
- Overpayment supported.
- Cancelled invoices rejected.

==========================================================
Reports
==========================================================

- General Ledger
- Trial Balance
- Journal Report
- Account Statement
- Balance Sheet
- Income Statement
- Cash Flow

- Reports read from Journal Entries.
- Never calculate independently.

==========================================================
Import Engine
==========================================================

- Excel.
- CSV.
- Download Template.
- Validation.
- Preview.
- Chunk Import.
- Rollback.
- Business Services only.

==========================================================
Export
==========================================================

- Excel.
- CSV.
- Print.

==========================================================
Audit
==========================================================

- Every document traceable.
- Every Journal traceable.
- Every Inventory Movement traceable.
- Every Payment traceable.
- Audit Trail required.

==========================================================
Forbidden
==========================================================

- Manual Journal Creation outside Posting Engine.
- Manual Inventory Adjustment outside Inventory Engine.
- Duplicate Posting.
- Negative Inventory.
- Return without Invoice.
- Posting to Closed Period.
- Unbalanced Journal.
- Duplicate Payment Allocation.
- Duplicate Inventory Movement.
- Bypassing Matching Engine.
- Bypassing Posting Engine.

==========================================================
Self Review
==========================================================

Before every Accounting task verify:

- Workflow ✔
- Posting ✔
- Inventory ✔
- COGS ✔
- Receivable ✔
- Payable ✔
- VAT ✔
- Matching ✔
- Journal ✔
- Periods ✔
- Reports ✔
- Audit ✔

If any check fails: fix automatically. Never finish until all checks pass.
