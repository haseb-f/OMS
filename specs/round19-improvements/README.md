# Round 19 — improvement round (owner brief 2026-10-13)

Three workstreams, each in its own worktree, integrated on `feat/r19` and previewed locally.
**Publication:** owner reviews the local preview + before/after evidence first (agreed process since R16);
nothing is pushed to `main` until approved.

## A. Recipes + stocked assembly for agent-owned products (`feat/r19-agent-assembly`)

Business case: agent components are received (R18 consignment receipts), assembled into finished boxes by
recipe, and the boxes are held as available stock (stocked assembly — `supplyMethod = ASSEMBLED`, never a kit).

Already in place (verified in code): recipes require one owner for the finished product and every
component (`RECIPE_OWNER_MIXED`, `ASSEMBLY_OWNER_MIXED`); recipe versioning, cycle and quantity checks;
assembly locks products, is idempotent by key, consumes components + receives output in one transaction,
snapshots the recipe version, never posts the journal and refuses a direct cost for agent stock.

Gaps to close:

1. `ASSEMBLY_COMPONENT_COST_MISSING` blocks every agent assembly (agent goods never have a cost) — agent
   assemblies are non-valued: no cost requirement, no unit cost on movements, no valuation update
   (`applyAssemblyOutput`), no inventory-asset / COGS / variance entry; company assemblies unchanged.
2. Availability must respect reservations (available = on hand − reserved) for components.
3. Reversal (disassembly): explicit, permission-gated, refused when the finished boxes are no longer
   available (sold / reserved / shipped); non-valued for agent stock.
4. Web: recipe panel + assembly dialog accept agent-owned products (pickers scoped to the same agent),
   show required / available / shortage / finished quantity; assembly stays an internal right
   (`inventory` assembly permissions) — never granted to agent portal roles.
5. Traceability: component receipt (ASR) → assembly (ASM, recipe version) → finished-box movements →
   reservation / shipment / return, visible in the agent stock history.

Acceptance (A): receive components → assemble 100 boxes (2 × A + 1 × B) → A −200, B −100, box +100 →
reserve / ship boxes (components untouched) → return 1 box → reconcile; zero journal lines; shortage and
reserved components refused without partial movements; concurrent / retried confirm posts once; reversal
refused when boxes are gone, allowed otherwise; company assembly + costing unchanged.

## B. Contrasting sidebar (`feat/r19-sidebar`)

Light theme: dark charcoal sidebar; dark theme: near-white / soft light-gray sidebar. Text, icons,
dividers, active item, hover, focus, expanded groups, company selector, account controls, collapsed rail
and mobile drawer adapt through shared semantic tokens (`--sidebar-*`), in every layout (company, agent,
partner, investor). Active destination unmistakable; brand accents and radii kept; AA contrast; no
per-page overrides; navigation behaviour and permissions unchanged.

## C. Sales-report cards (`feat/r19-sales-cards`)

Noticeably stronger cards on every sales-report screen (live reports, employee / team performance,
comparisons, payment / collection summaries; company and agent roles): larger cards and figures, readable
titles, stronger semantic colours, soft glass with opaque fallback, visible hover (elevation, tint,
border, shadow) without moving neighbours, focus + reduced motion + touch resting state, no truncated
amounts, no horizontal overflow, no expensive blur on long repeated lists. Shared report-card components
only; metric definitions, calculations, filters, permissions and the record-grid status cards unchanged.

## Delivery

Automated checks + production builds on the integrated tree; before (Production = main `5c17aabb`) /
after screenshots; local preview of (1) agent components → finished boxes, (2) sidebar in both themes,
(3) the redesigned sales-report cards. Implementation, verification and deployment reported separately.
