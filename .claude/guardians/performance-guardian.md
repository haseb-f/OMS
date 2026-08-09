# Performance Guardian

Owns 100% of OMS Performance. Every implementation task MUST load this
Guardian. If performance rules are violated, the task is NOT complete.

==========================================================
Architecture
==========================================================

- Reuse existing Services.
- Reuse existing Components.
- Reuse existing Hooks.
- Reuse existing Utilities.
- Reuse existing DTOs.
- Reuse existing Validators.
- Reuse existing Tables.
- Reuse existing Dialogs.
- Never duplicate logic.
- Never duplicate APIs.
- Never create parallel implementations.

==========================================================
Backend
==========================================================

- Small Services.
- Small Controllers.
- Small Modules.
- Single Responsibility.
- Transaction where required.
- Avoid nested service chains.
- Avoid circular dependency.
- No dead code.
- No TODO.
- No placeholder logic.

==========================================================
Database
==========================================================

- Always paginate.
- Always filter server-side.
- Always sort server-side.
- Never fetch unnecessary fields.
- Always use select/include carefully.
- Never SELECT *.
- Avoid N+1 queries.
- Prefer joins over loops.
- Use indexes for searchable fields.
- Use transactions for financial operations.

==========================================================
Prisma
==========================================================

- Prefer select.
- Minimize include.
- Avoid repeated queries.
- Batch where possible.
- Reuse Prisma transactions.
- Never duplicate query logic.

==========================================================
React
==========================================================

- Small Components.
- Shared Components.
- Avoid unnecessary re-render.
- Memoize expensive calculations.
- Lazy load heavy pages.
- Code split when appropriate.
- Avoid prop drilling.
- Prefer composition.

==========================================================
Tables
==========================================================

- Server pagination.
- Server search.
- Server sort.
- Server filter.
- Virtualize only if needed.
- Never load entire datasets.

==========================================================
Import Engine
==========================================================

Every import must support:

- Excel
- CSV
- Template download
- Validation
- Preview
- Chunk processing
- Transaction
- Rollback
- Detailed error report
- Progress

Rules:

- Reuse Business Services.
- Never bypass Posting Engine.
- Never bypass Inventory Engine.

==========================================================
Export Engine
==========================================================

- CSV.
- Excel.
- Print.
- PDF (future ready).
- Stream large exports.

==========================================================
Network
==========================================================

- Minimize requests.
- Batch requests.
- Avoid duplicate requests.
- Cache static data.
- Reuse loaded data.

==========================================================
Frontend UX Performance
==========================================================

- Fast page load.
- Fast navigation.
- Fast search.
- Fast filters.
- Fast dialogs.
- Instant feedback.
- Skeleton before spinner.

==========================================================
Accounting
==========================================================

Never bypass:

- Posting Engine
- Inventory Engine
- Validation Engine
- Matching Engine
- Import Engine

==========================================================
Security
==========================================================

- Permission check first.
- Validation first.
- Never trust frontend.

==========================================================
Code Quality
==========================================================

- Readable.
- Maintainable.
- Reusable.
- Predictable.
- Simple.

==========================================================
Forbidden
==========================================================

- Duplicate Services.
- Duplicate Components.
- Duplicate Queries.
- Duplicate Hooks.
- Client-side filtering on ERP lists.
- Client-side sorting on ERP lists.
- Loading all rows.
- Business logic inside Components.
- Manual SQL.
- Hardcoded values.
- Dead code.

==========================================================
Self Review
==========================================================

Before every task verify:

- Reuse ✔
- No Duplication ✔
- Performance ✔
- Database ✔
- React ✔
- Backend ✔
- Frontend ✔
- Architecture ✔
- Security ✔
- Maintainability ✔

If any check fails: fix automatically. Never finish until all checks pass.
