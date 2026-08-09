@.claude/OMS.md

# OMS Project Execution Policy

This is the permanent execution policy for the OMS project — a long-term
Enterprise ERP effort. It governs _how_ work gets done, alongside
`.claude/OMS.md`'s record of _what_ has been decided (architecture, business
rules, ADRs). Both apply together; neither overrides the other.

## General Principles

- Always prefer maintainability over shortcuts.
- Follow the existing Design System — never introduce a one-off visual
  pattern a shared component should provide instead.
- Never create duplicate components. Reuse shared components whenever
  possible.

## Implementation Policy

Complete the entire requested task before stopping. Do not stop after every
small implementation step.

Only stop mid-task if:

- A business decision is required.
- The requirement is ambiguous.
- The requested action may destroy data.

Otherwise, follow this loop to completion: **Read → Analyze → Implement →
Typecheck → Lint → Logic Verification → Stop.**

## Lean Verification Policy

Browser verification is expensive — never use it as the primary way to
verify correctness. Prefer, in order: TypeScript, ESLint, build, and
unit/logic verification.

Browser verification is allowed only when:

1. The user explicitly requests UI review.
2. The task is inherently visual (UI/UX).
3. It's the final review of the task.

When browser verification is needed:

- Perform ONE browser pass only.
- Verify only the affected page(s).
- Never browse unrelated pages.
- Never perform repeated browser passes.
- Never take unnecessary screenshots.

## Reporting Policy

Keep reports concise — maximum 8 lines. Report only:

- Completed work.
- Blocking issues.
- Important changed files (if needed).
- What should be tested next.

Never generate long implementation reports unless requested.

## Code Quality Policy

- Never duplicate code.
- Never create page-specific styles when a shared component should be
  updated instead — always improve the shared Design System first.
- Every new UI must reuse the shared Buttons, Inputs, Dialogs, Tables,
  Forms, Cards, and Notifications — never a bespoke rebuild of any of these.

## Design Policy

Maintain a premium Enterprise ERP appearance, in the spirit of Microsoft
Dynamics, Odoo Enterprise, Linear, Atlassian, and Stripe Dashboard.

Avoid: fancy animations, mobile-like UI patterns, excessive rounded
corners, and decorative effects.

## UX Policy

- Always minimize user clicks; prefer smart defaults.
- Hide unnecessary fields; use progressive disclosure for advanced options.
- Generate codes/document numbers automatically — never require the user to
  type one manually.

## Responsive Policy

Every page must work correctly on Desktop, Laptop, Tablet, and Mobile.

- No horizontal scrolling.
- Tables must adapt intelligently.
- Dialogs must remain usable on small screens.

## Print Policy

Printing is not a screenshot — every printable document needs a dedicated
print layout.

Orientation:

- **Portrait:** invoices, receipts, journal entries.
- **Landscape:** reports, statements, order lists, tables.

Every printable document includes: company logo, company information,
print date, page numbers, and a QR code where applicable.

## Success Feedback Policy

Every successful operation must provide clear visual confirmation. Every
failed operation must explain the reason. Never leave the user wondering
whether an action succeeded — use enterprise-quality toast/dialog feedback
consistently.
