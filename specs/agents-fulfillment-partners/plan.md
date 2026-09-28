# Plan — Agents / Fulfillment Partners

Master: specification, schema/identity foundation, integration, review, release. Subagents own
bounded file sets (tasks.md). Each wave ends with typecheck + lint + tests of the touched projects.

## Wave 0 — foundation (master)

- Prisma schema + migration `20260928120000_agents_fulfillment_partners` (additive; check
  constraints: user affiliation, ledger amounts, agreement terms; append-only ledger trigger;
  number series AG / AGR / AL / APO / ART).
- Identity: `User.userType/agentId/agentRole`; JWT `typ: "agent"` + `agentId`; `JwtAuthGuard`
  deny-by-default for agent tokens with live affiliation check; `@AgentPortal()` /
  `@AgentShared()`; resolver confines agent users to `agent.*` and drops `agent.*` from internal
  users; internal pools (`getUsersWithPermission`) exclude agent users; users service rejects
  cross-type grants; `/auth/me` exposes `userType`, `agentRole`, `agent`.
- Permission catalog: `agents`, `agent-users`, `agent-finance` (internal) and `agent-portal`
  (`agent.*`), role presets.
- `src/agents/common`: `@CurrentAgent()`, `AgentPermissionGuard` + `@RequireAgentPermission()`,
  `AgentVisibility` helper (own vs view_all).

## Wave 1 — backend (parallel)

- **B1 Agent admin + orders** — Agent CRUD (partner with role AGENT), agreements (effective-dated,
  overlap-safe, activate/end, immutable terms), shipping rates, payment destinations, agent users
  (create from the Agent team tab; presets; Agent Admin delegation rules), product ownership
  (set/immutable rule, movement owner stamping in `InventoryService`), pricing library (modes A/B,
  allocation, validation) with unit tests, agent order creation (direct + lead conversion) with
  server-derived agent/agreement/snapshot, payable-total integration (declaration core, fulfillment
  gate, economics), agent filter/badge data on internal store-order + shipping lists, block
  `generate-invoice` for agent orders, exclude agent leads/orders from internal distribution and
  sales performance.
- **B2 Agent finance** — ledger service (append-only, idempotent keys, availability), posting
  provider `AGENT_*` + PostingSettings accounts (PENDING_CONFIGURATION when unset), hooks: dispatch
  (stock issue + shipping fee), earning event (commission, retained shipping, service fee), returns
  (stock + reversal + return fee), payment verification (company → collection credit + GL clearing /
  agent funds payable; agent destination → memo), settlement provider-fee attribution, refunds,
  adjustments, payouts (lock, FIFO allocation, idempotency, reversal), statement + summary API,
  internal Agent collections queue and finance endpoints.

## Wave 2 — portal API + web (parallel)

- **B3 Portal API** — `/agent-portal/*`: me/dashboard, leads (create/list/convert), orders
  (quote/preview, create, list, detail with progress), payment declarations (destinations, proof),
  stock, statement (+ print data), payouts, team (Agent Admin delegation), agent-scoped attachment
  download. Every query from `agentContext`.
- **W1 Internal web** — Agents list/workspace tabs, agreement editor, destinations, team, products
  & stock, orders, statement (print/export), payouts dialog, Agent collections queue, posting
  accounts in settings, agent column/filter in store orders and shipping, Users page user type.
- **W2 Agent portal web** — agent navigation audience, route guard, dashboard, leads, new order with
  the two pricing modes + live breakdown, order detail + declaration, stock, statement + print,
  payouts, team.

## Wave 3 — verification and release (master + reviewers)

- Integration specs (real Postgres): separation (every agent token → 403 on internal endpoints;
  cross-agent 404), pricing, lifecycle, ledger/statement reconciliation, concurrent payouts,
  duplicate requests, effective-dated agreements.
- Independent security review and financial-integrity review; fix findings.
- Gates: api + web typecheck, lint, tests, builds. Commit (separate from print). Push → Production
  deploy; Production acceptance with tagged demo records (`DEMO-AGT-20260928`); Arabic guides and
  handoff with evidence.
