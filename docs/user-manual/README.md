# OMS Arabic user manual (R15)

Branded, illustrated Arabic user manual for OMS release **R15** (`main` @ `8c43566e` + capture fixes `f26b0ec5`,
prepared 2026-10-10). R15 scope: `specs/round15-completion/` (decisions, handoff). First version (R14):
`specs/round14-production-readiness/spec-7-arabic-manual.md`.

| Output                                      | Path                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| Editable Word document                      | `OMS-دليل-المستخدم-R15.docx`                           |
| PDF                                         | `OMS-دليل-المستخدم-R15.pdf`                            |
| Chapter sources (Arabic Markdown subset)    | `source/01-…13-*.md`                                   |
| Screenshots (clean / annotated)             | `screenshots/raw/*.png`, `screenshots/annotated/*.png` |
| Brand assets (from `apps/web/public/brand`) | `assets/oms-logo.png`, `assets/oms-icon.png`           |
| Build scripts                               | `build/`                                               |
| QA record                                   | `QA.md`                                                |

Both the DOCX and the PDF are generated from the **same** `source/*.md` files and the same annotated
screenshots, so their content is identical (their pagination differs: the PDF is laid out by Chromium,
the DOCX by Word).

## Source format (Markdown subset)

One construct per line group — see the docstring of `build/manual_source.py`:

- `# ` chapter (one per file, files are ordered by their `NN-` prefix), `## ` section, `### ` subsection.
- Plain lines → paragraph. `**bold**`, `` `code` `` (codes, phone numbers, document numbers: rendered LTR, monospace).
- `1. ` numbered step (an indented `  -` line is a sub-bullet of that step); `- ` bullet.
- `![caption](shot-id)` → figure from `screenshots/annotated/<shot-id>.png`, numbered automatically «شكل n».
- `- [n] text` directly after a figure → legend that explains badge _n_ on the screenshot.
- `| a | b |` table (first row = header, second row `| --- |`).
- `> [!note|tip|warn] title` + following `> …` lines → note box (`> - x` = bullet inside the box).

## Rebuild

Prerequisites: Docker container `oms-postgres` (:5434), the local API build `apps/api/dist` and web build
`apps/web/.next` of the release, Python 3.10 with python-docx, Node 24 (Playwright and sharp resolve from
the repo). Use Git Bash with `MSYS_NO_PATHCONV=1`.

```bash
# 1. Demo database. R15 was built by migrating the R14 manual database forward (the deployed-schema path):
#      docker exec oms-postgres psql -U oms -d postgres -c "CREATE DATABASE oms_r15_manual TEMPLATE oms_r14_manual"
#      (apps/api, DATABASE_URL=…/oms_r15_manual) pnpm exec prisma migrate deploy && pnpm exec ts-node prisma/provision-permissions.ts
#      cp tmp/r14-manual/.env tmp/r14-manual/state.json tmp/r15-manual/   (then API/WEB/DB/BAKED_API in .env as below)
#    A brand-new database instead: bash docs/user-manual/build/prepare-db.sh (writes tmp/r15-manual/.env).
#    tmp/r15-manual/.env (git-ignored): MANUAL_PW, API=http://localhost:4505, WEB=http://localhost:4501,
#    DB=oms_r15_manual, BAKED_API=http://localhost:4505 (the API URL baked into the web build).

# 2. Servers on the demo DB: API :4505 and web :4501 (web built with NEXT_PUBLIC_API_URL=http://localhost:4505).
#    When API differs from BAKED_API the screenshot scripts forward the baked URL to API (Playwright routing).
pnpm --dir apps/api exec nest build && NEXT_PUBLIC_API_URL=http://localhost:4505 pnpm --dir apps/web exec next build
node -e "process.env.PORT='4505';process.env.WEB_APP_URL='http://localhost:4501';process.env.DATABASE_URL='postgresql://oms:oms@localhost:5434/oms_r15_manual?schema=public';process.chdir('D:/Systems/OMS/apps/api');require('D:/Systems/OMS/apps/api/dist/src/main.js')" &
pnpm --dir apps/web exec next start -p 4501 &

# 3. Demonstration data through the API (idempotent; progress in tmp/r15-manual/state.json)
node docs/user-manual/build/demo-data.mjs

# 4. Screenshots (all, or ONLY=05-03,08-04 for some) + optimisation (palette PNG, ≤ ~250 KB)
node docs/user-manual/build/shots.mjs
node docs/user-manual/build/optimize-images.mjs

# 5. DOCX + HTML, then PDF (two passes so the PDF table of contents has real page numbers)
python docs/user-manual/build/build.py
RENDER=1 node docs/user-manual/build/pdf.mjs      # RENDER=1 also renders every PDF page to PNG for QA

# 6. QA
python docs/user-manual/build/qa_docx.py           # RTL / bookmarks / hyperlinks / images invariants
node docs/user-manual/build/contact-sheet.mjs      # build/out/sheets/*.png: 8 PDF pages per image
```

`build/out/` (HTML, JSON, rendered pages) is a build artefact and is not committed.

## Personas used for the screenshots

All fictitious, password only in `tmp/r15-manual/.env`: `admin@oms-demo.local` (أحمد سالم, super admin),
`sales@` (منى عادل, «موظف مبيعات» + R15 grants: lead / order import and sales reports), `sales2@` (يوسف كمال,
«مشرف مبيعات» + one individual grant and deny), `shipping@` (كريم فؤاد, «مسؤول الشحن»), `accountant@`
(هالة مراد, «محاسب عام» + R15 refunds / reversal / reconciliation / agents finance / partner logins),
`agent@` (ياسر نبيل, agent admin of «مؤسسة الواحة للتوزيع»), `agent2@` (مروان سعد, agent sales — R15),
`partner@` (خالد منصور's partner login — R15). Phone numbers follow `+20 10 0000 0xxx`. Password fields are
blanked before every capture.

## Demo data notes

- Store orders, shipping, recognition, returns, purchases and the B2B sale happen on the build day (October 2026).
- September 2026 is recorded as the month before the company started on OMS: two summary journal entries
  (sales 30,000 / cost of sales 12,000) and three expense vouchers dated in September. This makes September a
  past period that can be **closed** for the partners (a period closes only after its last Cairo day), while
  October stays a saved review (تقديري) whose Close action is disabled.

- R15 steps (end of `demo-data.mjs`): stock backfill of the R14 demo orders; payment-method accounts and a
  carrier COD method; R15 store orders for every stock state (reserved, short, in transit, partially delivered,
  failed and received back, returning, prepaid verified, returned with refund due, refunded, COD matched with the
  carrier statement); Excel imports of leads and orders (one rejected row, one row for review); an agent sales
  user with a lead and an order, and a duplicated shipping-agreement draft from 1 November; the partner login.
  R15 screenshots resolve their orders by the (fictitious) customer name, not by number.

## Updating for a new release

Change `build/meta.py` (version, SHA, date, file stem), update the chapter text, re-run steps 3–6, and
re-check every screen against the released code (the manual documents only what exists).
