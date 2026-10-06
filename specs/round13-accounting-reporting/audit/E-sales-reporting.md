# Audit E — sales reporting (2026-10-06)

- `/reports/sales` is a `ComingSoonPage` stub (as are executive, crm, purchasing, expenses, custom, shipping, analytics). Report children have no own permission → ungated in web; no `reports.sales.*` permission exists.
- `GET /sales/performance` (home dashboard): server-local dates (not Cairo), orders by `createdAt` without status filter, delivered by `updatedAt`, no money, ranking counts orders only; JwtAuthGuard only.
- Sales targets: SALES_REVENUE sums `agreedAmount` by `orderDate`, no cancellation filter, no currency separation, UTC months.
- StoreOrder: no single status; `fulfillmentStatusId` → StatusDefinition codes (UNFULFILLED, READY, PROCESSING, SHIPPED, DELIVERED, FAILED, RETURNED, CANCELLED, AWAITING_PREPARATION, READY_FOR_PICKUP, COLLECTED); `paymentStatus`; `paymentType` PREPAID/COD; `orderDate` (indexed); `currencyId` required; `payableTotal` (nullable legacy → sum of item agreedAmount, `storeOrderPayableTotal`); owner `employeeId`; `agentId` null = company order.
- Scope: `SalesScopeService.resolve` ALL/TEAM/OWN/NONE + `storeOrderWhere`; agents `resolveAgentVisibility` + `agentStoreOrderWhere` (`agent.records.view_all`).
- UI: `InsightCard`/`InsightSurface`/`InsightGroup`, `DashboardPanel`, `ShareBar`, `PageWorkspace`, `useLoad`. **No chart library**; no polling/visibility refresh hook.
- Time: API `common/time/business-date.ts` (Africa/Cairo, `businessDateRangeFilter`, `todayBusinessDate`, `addCalendarDays`); web `lib/business-date.ts`.
- New nav ids need `home.destinations.<id>` in en+ar (`module-overview.spec.ts`).
