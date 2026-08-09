# ERP Decisions

Stores OMS business decisions. Never override these decisions. If future
tasks conflict with this file, this file wins.

==========================================================
Architecture
==========================================================

- Single Company ERP.
- No SaaS.
- Reuse existing Services.
- Reuse existing Components.
- Never duplicate logic.

==========================================================
Accounting
==========================================================

- Double Entry.
- Accrual Accounting.
- Perpetual Inventory only.
- Moving Average Cost only.
- Posting Engine is the only posting source.
- Inventory Engine is the only inventory source.
- Matching Engine is the only payment allocation source.
- Journal Entries are immutable after posting.

==========================================================
Sales
==========================================================

- Sales Return must reference one Sales Invoice.
- Customer Receipt may be direct or allocated.
- Customer Receipt UI name = سند قبض.
- Receipt never creates Revenue.

==========================================================
Purchasing
==========================================================

- Purchase Return must reference one Purchase Invoice.
- Supplier Payment UI name = سند صرف.
- Payment never creates Expense.

==========================================================
Inventory
==========================================================

- No negative inventory.
- Inventory moves automatically.
- No manual accounting for inventory.

==========================================================
Tax
==========================================================

- Tax is OPTIONAL.
- Line-level tax.
- Document may contain taxable and non-taxable lines.
- Empty tax = No VAT posting.
- Never force tax selection.

==========================================================
Chart of Accounts
==========================================================

- Hierarchical Tree.
- Parent / Child.
- Allow Reconciliation.
- Currency supported.

==========================================================
Imports
==========================================================

Sources: Excel, CSV, Manual Entry.

- No Bank Integration.
- No Payment Gateway Integration.

Every Import Screen must provide:

- Download Template
- Upload
- Validation
- Preview
- Error Report

==========================================================
UI
==========================================================

- UI Guardian is mandatory.
- One Calendar.
- One Dropdown.
- One Table.
- One Form System.
- Compact Enterprise UI only.

==========================================================
Performance
==========================================================

- Performance Guardian is mandatory.

==========================================================
Reports
==========================================================

- Reports read only from Journal Entries.
- Never calculate balances separately.

==========================================================
Permissions
==========================================================

- Permission check before every action.

==========================================================
Future
==========================================================

- Multi Company may come later.
- APIs may come later.
- Banking may come later.

Current scope must never depend on future features.
