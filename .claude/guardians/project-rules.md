==========================================================
Architecture
==========================================================

- Reuse existing Services.
- Reuse existing Components.
- Never duplicate Business Logic.
- Never bypass Posting Engine.
- Never bypass Validation Engine.
- Never bypass Inventory Engine.
- Never hardcode business rules.
- Prefer composition over duplication.
- One shared component for every repeated UI element.

==========================================================
Backend
==========================================================

- SOLID.
- Clean Architecture.
- Small Services.
- Small Components.
- Shared Utilities.
- Repository Pattern.
- Transactions where required.
- Never create dead code.
- Never leave TODO.
- Never create placeholder implementations.
- Never use mock data.

==========================================================
Frontend
==========================================================

- RTL First.
- Arabic First.
- Shared Components only.
- Compact UI.
- Enterprise UX.
- No page-specific components.

==========================================================
Accounting
==========================================================

- Posting Engine is the only accounting source.
- Inventory Engine is the only inventory source.
- Journal Engine is the only journal creator.
- Import Engine must reuse Business Services.
- No manual journal generation outside Posting Engine.

==========================================================
Quality
==========================================================

- Before finishing every task run:
  - TypeScript
  - ESLint
  - Production Build
- Fix every error before returning.

==========================================================
General Rules
==========================================================

- Do not introduce unnecessary dependencies.
- Prefer existing libraries.
- Keep code simple.
- Keep files maintainable.
- Prefer reuse.
- Avoid complexity.
