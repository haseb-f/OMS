# Handoff — enterprise-ui-overhaul

- **Status: ACTIVE since 2026-09-27.** Started after the payment milestone was verified. At the
  baseline, HEAD = origin/main = Production = `0426316`.
- **Session:** "OMS enterprise UI/UX design system overhaul" is the Master. Nothing is committed yet;
  all work is in the working tree.
- **Done (Master):**
  - Inventories: `inventory-*.md`, four files.
  - Before baseline in `tmp/ui-baseline/before`, captured by `scripts/acceptance/ui-baseline.mjs`.
  - `design-system.md`, `plan.md`, `tasks.md`.
  - Tokens in `globals.css` and `theme/tokens.css`. They pass `node scripts/design/contrast-check.mjs`.
  - Primitives in `components/ui/*`: flat, one focus ring, a `field` variant, AA badges, no
    blur/zoom.
  - Shell:
    - flush sidebar
    - breadcrumbs inside the 48px top bar
    - token gutters and 1720px content
    - the `data-viewport-fill` hook
    - Finance navigation grouped into four sub-groups
- **Running:** SC-TABLE, SC-REPORTS, SC-DOCS and SC-FEEDBACK. Ownership is listed in `plan.md`.
- **Next:**
  1. Integrate the four tracks.
  2. Gates.
  3. Local renders of the sample screens.
  4. ADOPT for the remaining modules.
  5. REV.
  6. Release: commit, push, check the Production SHA.
  7. Production browser QA.
  8. After baseline and the Arabic guide screenshots.
- **Recovery:** if the session dies, `git status` shows the full working-tree change set. Re-run the
  gates, typecheck and lint before committing.
- **Decisions:**
  - Numbers align to the logical end (the left edge in Arabic).
  - Digits are Latin in both locales, on screen and in print.
  - Buttons and fields share one height: 32px, or 40px on touch.
- **Input kept from the payment milestone:** `ProductPicker` options show "SKU · price" (`0331a58`).
  The redesigned picker keeps this.
