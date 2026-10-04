# Cross-session completion register (2026-09-29/30)

Integration/release owner: session "Cross-session completion audit" (this register). Other
sessions were contacted through Claude Desktop session messaging; all were idle and acknowledged
or had no uncommitted work. Evidence was checked against the repository, GitHub deployments and
the sessions' own transcripts — not against checkboxes or handoff claims alone.

Production before this pass: `1b8955f` (GitHub deployment 6740618538, success) = `origin/main` = local `main`.

## Milestones

| #   | Milestone                                                                                                            | Owner session                                                                                                        | Scope / latest owner corrections                                                                                                                                                                                                                               | State (evidence)                                                                                                                                                              | Open                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | UI design system (Round 3/4, Vercel reference)                                                                       | "OMS enterprise UI/UX design system overhaul", "Vercel-reference redesign pilot", "local UI polish", "compact forms" | Round 3/4 canonical app-wide                                                                                                                                                                                                                                   | **Live** since 93fc9ee (2026-09-28)                                                                                                                                           | `round4-proposal.md` (untracked, "UI/UX modernization" session) is a superseded proposal — kept local, not an input (usability spec)                                                                                                                               |
| 2   | Kumo dropdown triggers + connected button groups                                                                     | "OMS Kumo UI dropdown/button refinement"                                                                             | Shared chevron, flush groups, Escape, RTL                                                                                                                                                                                                                      | **Live** `1b8955f`, Prod-verified on oms.haseb.org (AR, desktop + 390px)                                                                                                      | none; `.claude/launch.json` local-only (untracked, never committed)                                                                                                                                                                                                |
| 3   | Usability refinements + financial report correctness                                                                 | "OMS usability refinements and financial report"                                                                     | Bulk selection menu, phone field, report switcher, toasts, table surfaces; IS/BS/TB/CF correctness                                                                                                                                                             | **Live** `f75db61` → `19f34b2`; 12/12 Prod reconciliation checks                                                                                                              | P4–P12 policy points (defaults applied, see `usability-financial-reports/accounting-review.md`)                                                                                                                                                                    |
| 4   | Cairo reporting days (P9), selling-cost lines (P2), derived opening balances (P1), investor principal ≠ expense (P3) | same                                                                                                                 | Year-end carry-forward without duplicate balances; principal repayment → investor funding                                                                                                                                                                      | **Live** `19f34b2` (migration 20260929140000 applied)                                                                                                                         | none — historical 551 postings stay flagged, not rewritten                                                                                                                                                                                                         |
| 5   | Printing (print design system)                                                                                       | print sessions                                                                                                       | Dedicated print layouts                                                                                                                                                                                                                                        | **Live** (3706911, a126bdd revert of auto widths)                                                                                                                             | optional `NEXT_PUBLIC_PRINT_COMPANY_NAME` on Vercel                                                                                                                                                                                                                |
| 6   | Agents / fulfillment partners (identity separation, agent stock, ledger, payouts, portal)                            | "Agent/staff separation and payment breakdown"                                                                       | External agent users separated from internal Shipping/Finance                                                                                                                                                                                                  | **Live** `923b4b4`/`41f159a`; Prod acceptance 26 pass, 8 blocked by D1, 0 fail                                                                                                | **D1** (3 GL accounts) and **D2–D6** confirmation — owner                                                                                                                                                                                                          |
| 7   | Commission + shipping policy correction                                                                              | "OMS commission policy and dashboard redesign"                                                                       | Explicit PRODUCT/SERVICE item type; agreement product/service rates; item overrides incl. 0%; predetermined agent shipping charge; customer shipping belongs to company and settles that charge (no double deduction); carrier invoices never charge the agent | **Live** `888c202` + `2c21c75` (migration 20260929120000); Prod: 30 PRODUCT / 6 SERVICE / 0 unclassified, AG-0001 closing −1,190.00 unchanged                                 | **Owner decisions:** (a) who bears/receives a difference between customer shipping collected and the agent shipping charge (currently rejected, both amounts shown); (b) do agent shipping prices vary by carrier/service level, or destination + ship/pickup only |
| 8   | Agent reporting (item-level commission report, statement, portal) on Cairo days                                      | same                                                                                                                 | Product/service summaries; entitlement ≠ available cash                                                                                                                                                                                                        | **Live** `2c21c75`                                                                                                                                                            | none                                                                                                                                                                                                                                                               |
| 9   | Automatic carrier-cost matching                                                                                      | same                                                                                                                 | Superseded by correction 2: actual carrier cost is company expense / order profitability only; recovery-from-agent removed before release                                                                                                                      | **Live**: import, auto-match, charge kinds BASE/SURCHARGE/CREDIT, confirm, mark paid                                                                                          | Bulk confirm / reject — **added in this pass** (row 11)                                                                                                                                                                                                            |
| 10  | Dashboard redesign (Clarity-inspired)                                                                                | same                                                                                                                 | White canvas, calm cards, real data only                                                                                                                                                                                                                       | **Local, awaiting owner visual approval** — branch `feat/dashboard-redesign`, rebased onto `1b8955f` as `8d2f594`; screenshots `docs/user-guide/evidence/dashboard-20260929/` | Owner visual approval; not deployed                                                                                                                                                                                                                                |
| 11  | Queued UX requirements (this pass)                                                                                   | this session                                                                                                         | × close on every notification; bulk actions per table; selection menu (page / all filtered / first N / clear); visible count + scope; server validation, duplicate-safe, partial-failure results; slightly softer sidebar radius                               | see "This pass"                                                                                                                                                               | —                                                                                                                                                                                                                                                                  |

## This pass — what was unfinished and is now done

| Requirement                           | Before                                                                                                                           | Now                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visible accessible × on notifications | Only error / persistent toasts had one; sonner's default hung off the card corner                                                | Every toast (all tones, loading) has a labelled × inside the card at the logical end corner, 24px target, focus ring, reserved gutter so it never covers the title, Retry, or controls behind the toast |
| Selection menu                        | Page + clear everywhere; "all matching" on 5 lists and "first N" on 3 only                                                       | Every table offers all four: built into `EnterpriseDataTable` from in-memory rows (client) or the bounded `fetchAllRows` (server); caller `…/ids` endpoints still win                                   |
| Bulk actions                          | Many tables had checkboxes and no action; document lists printed/exported/archived only the selected rows **on the loaded page** | Print selected + Export selected on every table (export where the table exports); document lists resolve the whole cross-page selection, show exact eligible counts, name skipped ineligible records    |
| Approve/reject matching               | Row actions only                                                                                                                 | Carrier Reconciliation bulk Confirm matches / Unmatch (proposed matches only), permission-gated, server re-validates each charge, duplicates rejected, partial failures listed with reasons             |
| Sidebar radius                        | Items 8px                                                                                                                        | `--radius-sidebar-item` 10px; item box and height unchanged                                                                                                                                             |

Deliberately **not** added: bulk operations the domain does not have (posted journals, payroll runs,
fiscal periods, agent statements/payouts, stock and report tables get Print/Export selected only).

Details: `specs/usability-financial-reports/tables-selection.md` ("Built-in selection tools…"),
`feedback-and-report-nav.md` §5, `enterprise-ui-overhaul/design-system.md` §11.6.

## Gates (worktree `D:\Systems\OMS-ux`, branch `feat/ux-completion`, on top of `1b8955f`)

| Gate                                  | Result                                                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web typecheck / lint                  | clean / 0 errors (11 warnings, same as `main`)                                                                                                                                                                                    |
| Web tests                             | 67 files, 468/468                                                                                                                                                                                                                 |
| Web production build                  | success                                                                                                                                                                                                                           |
| API typecheck / lint (carrier module) | clean / 0                                                                                                                                                                                                                         |
| API tests (real local DB)             | 136 suites, 1,710/1,710 — after applying the already-released `20260929120000_agent_commission_policy` to the local dev DB, which was behind                                                                                      |
| API build                             | success                                                                                                                                                                                                                           |
| Independent review                    | 1 HIGH (bulk Unmatch could reverse a CONFIRMED charge from a stale list), 1 MEDIUM (stale record cache), 3 LOW — all fixed with server-side guards under the row lock, fresh re-reads and id de-duplication; 2 new API unit tests |

**Browser pass (one, local production build of this branch on :3031 against the local API,
`tmp/ux/probe.mjs`, AR-light / EN-dark / 390px AR):**

- Sales invoices: selection menu lists all four scopes («تحديد هذه الصفحة 20»، «تحديد كل النتائج
  المطابقة 55»، «تحديد عدد معين...»، «إلغاء التحديد»); the strip shows Archive · Print selected ·
  Export selected · "1 selected on this page" · Clear.
- Carrier Reconciliation (two local demo charges tagged `DEMO-UX-20260930-*`, UNMATCHED): strip
  shows Confirm matches · Unmatch · Print selected; bulk Confirm refused with the "none eligible"
  info toast, no dialog, no request.
- Toast ×: labelled («إغلاق الإشعار» / "Dismiss notification"), inside the card, at the logical end
  corner in both directions.
- Sidebar item radius 10px. Horizontal overflow 0 on every page and viewport; no page errors.
- **Phones (completed 2026-09-30):** cards keep row checkboxes; a selection bar above the cards
  carries the page checkbox and scope menu; the bulk strip wraps in flow — see
  `usability-financial-reports/tables-selection.md` "Phones and narrow containers".
- The branch's Vercel Preview (https://oms-fjbtni728-haseb-f-s-projects.vercel.app) is behind
  Vercel SSO, so it was not browsed by the release owner.

No Prisma migration in this pass. No financial record was created or changed; the browser probe is
read-only (never confirms, archives or submits).

## Release record

| Commit      | Content                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `d01441c`   | toast × on every notification; sidebar item radius                                                                      |
| `073562f`   | table selection scopes, Print/Export selected, cross-page bulk resolution, carrier bulk confirm/unmatch + server guards |
| this commit | register                                                                                                                |

- **Push to `main`:** `main` was moved to `7feea08` at 2026-09-30T05:11Z, but Vercel only built that
  SHA as the branch Preview (6752073039) and created no Production deployment. The release owner
  then pushed this register commit to `main` (owner-approved 2026-09-30) to trigger Production.
  After it, verify: deployed SHA via GitHub deployments, then `tmp/ux/probe.mjs` against
  https://oms.haseb.org (QA admin, AR light / EN dark / 390px mobile).
- **Preview of this branch:** Vercel Preview for `feat/ux-completion` (link in the final handoff).
- **Dashboard redesign:** Vercel Preview https://oms-fdsf5kxor-haseb-f-s-projects.vercel.app
  (`feat/dashboard-redesign` @ `8d2f594`, rebased on `1b8955f`; typecheck, lint, 6/6 tests and build
  pass). Not merged; awaits owner visual approval.

## Still requiring the owner

1. Push `feat/ux-completion` to `main` (above), or approve the release owner doing it.
2. Visual approval of the dashboard preview.
3. Agents D1 (three GL accounts: Agent Funds Payable, Agent Commission Revenue, Agent Fulfillment
   Service Revenue — proposals in `agents-fulfillment-partners/handoff.md` §8) and D2–D6
   confirmation. Until D1, agent postings stay pending (8 Production acceptance scenarios blocked).
4. Commission/shipping: treatment of a difference between customer shipping collected and the
   predetermined agent shipping charge (orders with a difference are refused today); whether agent
   shipping prices vary by carrier/service level.
5. Accounting P4–P12: defaults applied and documented; confirm or change.
6. Local cleanup (optional): `D:\Systems\OMS-kumo-verify` (unregistered copy, nothing unique);
   untracked `.claude/launch.json` and `specs/enterprise-ui-overhaul/round4-proposal.md` in the main
   checkout (owned by other sessions — left untouched).

## Final release state (2026-09-30)

| SHA       | Content                                                                                                                    | Production deployment                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8a67de9` | toast ×, sidebar radius, selection scopes, cross-page bulk actions, carrier bulk confirm/unmatch + server guards, register | 6752193931 — success; probe: menu scopes, Print/Export selected, sidebar 10px, overflow 0, no page errors; deployed CSS carries the toast-close rule and `--radius-sidebar-item`                                            |
| `61a5124` | phone selection bar + wrapping bulk strip                                                                                  | 6752508322 — success; `tmp/ux/mobile-probe.mjs` on Production: invoices and store orders at 390px AR/EN and 768px — bar, card checkboxes, "all matching" → `allMatching`, strip within viewport, overflow 0, no page errors |

Not verifiable on Production without creating financial records: Carrier Reconciliation bulk actions
(no charges there) — verified locally with tagged demo charges `DEMO-UX-20260930-*`.

**Preview access.** Both Vercel Preview links answer 302 → `vercel.com/sso-api`: that is Vercel
Deployment Protection (Vercel Authentication), not the OMS login. Only a Vercel member of team
`haseb-f-s-projects` (or a Shareable Link created from the Vercel dashboard) gets through; the release
owner has no Vercel access (CLI not installed, Vercel MCP not authorized), so it could neither create
a share link nor read which database the Preview environment uses. Working alternative: local review
stack `dashboard-review` (`.claude/launch.json`, `tmp/review/stack.cjs`) — dashboard branch on
http://localhost:3036 against a review API on :3035 using the local dev DB only; login path tested
end-to-end with the local seed account (`apps/api/prisma/seed.ts`).

Decisions awaiting the owner: `decisions-ar.md`.

## Round close (2026-09-30) — approved dashboard released

| SHA              | Content                                                                         | Production                      |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| `fec9e16`        | dashboard redesign (owner visual approval 2026-09-30 on the local review build) | —                               |
| `8497e88`        | review fix: bank summary loads independently; bank panel loading/error states   | deployment 6753153566 — success |
| next docs commit | guides, screenshots, this record                                                | docs only                       |

**Gates on the final integrated tree (8497e88):** web typecheck clean, lint 0 errors, 68 files /
474 tests, production build OK; API typecheck clean, lint clean, 1,709/1,710 in the full parallel
run — the one failure (`import-center/sync/data-synchronization.spec.ts`, 212 s under load) passes
alone 33/33 and the API code is identical to `63df5a6`, which passed 1,710/1,710; API build OK.

**Independent review (dashboard, permission-sensitive):** no permission leak; every section keeps
its previous gate and its endpoint is permission-guarded server-side. Fixed before release: MEDIUM-1
(one failing cash-flow call hid the attention queues) and MEDIUM-2 (bank panel silently missing).
Recorded, not changed:

- attention "unmatched" counts both directions (work queue) while the bank panel is incoming-only;
- ranking is hidden for own-scope users (part of the approved design; they lose the self-rank line);
- carried over from main: follow-up queue links point to `/crm/leads` for store-orders-only users;
  `/sales/performance` has JwtAuthGuard only (data is scope-limited server-side).

**Production browser verification (8497e88, QA admin, `tmp/ux/dashboard-probe.mjs`):** AR light,
AR dark, EN light, 390px AR — all five sections render; requests on load: 3 × sales performance,
1 × cash-flow summary, 1 × status counts, 2 × payments; period switch adds no request; no failed
request, overflow 0, no page errors. Screenshots: `docs/user-guide/evidence/dashboard-20260930/`.
Earlier UX items re-checked on the same SHA (`probe.mjs`, `mobile-probe.mjs`): Print/Export
selected, four selection scopes, sidebar 10px, phone selection bar + "all matching" + wrapping strip
— overflow 0, no page errors.

- **Not verified on Production:** external-agent redirect from `/` (the demo-agent credential
  available here is for the local demo agents; login did not complete) — code path unchanged and
  confirmed by review; Carrier Reconciliation bulk actions (0 charges on Production; verified
  locally with tagged demo charges).

**Repository alignment:** `origin/main` = deployed SHA; worktrees reconciled below.

## Round 8 (2026-10-04) — blue dropdowns, Home, dashboards

Owner message 2026-10-04: blue dropdown progression approved app-wide; Home screen and the dashboard
visual requirements declared **incomplete** until implemented and verified. Releases kept separable.

| #   | Milestone                                                                                                       | State                                                                                                                                                                    | Evidence                                                                                | Open                            |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------- |
| 12  | Blue dropdown triggers on every dropdown (forms, dialogs, inline editors, report filters, toolbars)             | **Live** — `204ccca`, Production deployment 6838735744 (success); verified on oms.haseb.org with computed colours                                                        | `specs/round8-blue-dropdowns/evidence.md`; design-system §12.16; `trigger-inventory.md` | none                            |
| 13  | **Home / الشاشة الرئيسية** launcher (`/`, `/agent`)                                                             | **Implemented, local only — awaiting owner visual approval.** `feat/r8-home-dashboard` @ `234f251`, review stack web :4401 / API :4405 / DB `oms_r7_final`. NOT deployed | `specs/round8-home-dashboard/evidence.md` (28/28 browser checks, server-side 403 proof) | Owner approval → merge + deploy |
| 14  | Dashboard visual refinement (company + agent): visible tone palette, glass surfaces, 28 px figures, hover/focus | **Implemented, local only — awaiting owner visual approval** (same branch/commit; 41/41 browser checks incl. no layout shift)                                            | same; design-system §12.17                                                              | Owner approval → merge + deploy |

**Milestone 1 (UI design system) is NOT closed:** Home and the dashboard refinement stay open until
the owner approves 13–14 and they are released. Not claimed complete anywhere.

Why the dashboard looked unchanged: the R6/R7 dashboard work was already on `main` (and in the
owner's :4301 preview) but deliberately faint — see `specs/round8-home-dashboard/plan.md`. A Home
screen had never been implemented anywhere.

Defect found by this round's verification and fixed on the same branch: insight cards, attention rows
and launcher tiles painted no keyboard focus ring (`outline-none` without `outline-solid`, Tailwind v4).
Open (unchanged, owner): FX revaluation policy, Prod permission grants, prettier CI debt — see
`.claude/OMS.md` / R7 evidence.
