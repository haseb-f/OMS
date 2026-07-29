# Sales Orders — Phase 1, 2 & Refactor: Business Workflow Design

Status: **Approved (current implementation)**. Phase 1 (this file, originally) was a
design-only draft with 11 open questions. TASK-011 approved specific answers to each
one ("Phase 2 approved decisions" below); TASK-012 then approved a further refactor
("TASK-012 refactor decisions" below), updating this document again **before** any
code was written, per that task's instruction. The current implementation follows this
document exactly.

## TASK-012 refactor decisions (superseding parts of Phase 2)

Six required changes, made before the Payment Verification module was built:

1. **`SalesOrderItem` renamed to `OrderItem`** (table `order_items`), matching the
   exact architecture vocabulary given: `SalesOrder -> OrderItem -> Product`
   (placeholder, never a direct link). No behavior change — Product was already never
   linked directly to `SalesOrder`.
2. **`Shipment` gains `status` (new `ShipmentStatus` enum), `labelUrl`, and `notes`.**
   Tracking number was already independent (never on `SalesOrder`) — unchanged. Label
   is now stored directly on `Shipment` _in addition to_ the existing tagged
   `SalesOrderAttachment` mechanism (which still preserves full label history across
   reships). `notes` is a plain field, not an unlimited collection — no "unlimited"
   wording was used for it, unlike `SalesOrderNote`/`PaymentNote`.
3. **`SalesOrderStatus` gains `LABEL_CREATED`**, inserted between
   `READY_FOR_SHIPPING` and `SHIPPED`. "Upload Shipping Label" now transitions the
   order into this stage. `RETURNED` remains reachable from any prior stage.
4. **Four operational-user FKs added to `SalesOrder`**: `createdById` (client-supplied
   at creation — distinct from the generic unenforced `created_by` audit column, since
   this one has explicit business meaning), `paymentVerifiedById` (auto-snapshotted
   from the Lead's most recent `VERIFIED` Payment at order-creation time — the direct
   link between this refactor and the Payment Verification module built right after
   it), `packedById` and `handedToShippingById` (schema-only in this phase — no
   operation sets them yet, since none was requested; see remaining work).
5. **`Shipment.attemptNumber`** added (1, 2, 3...), matching the literal `#1 / #2 / #3`
   numbering in the given diagram. Confirms the Phase 2 `Shipment` sub-entity design
   was already the right shape for "unlimited shipping attempts" — this just makes the
   ordinal explicit instead of relying on `createdAt` ordering alone.
6. **`ShipmentStatus` gains `RETURN_BEFORE_DELIVERY` / `RETURN_AFTER_DELIVERY`**
   (replacing a generic returned state at the shipment level). `SalesOrderStatus`
   keeps a single `RETURNED` — the order-level workflow diagram was never given a
   before/after split, only the return itself needed distinguishing, and that detail
   lives on the specific `Shipment` that was returned. `ReturnOrder` infers which one
   applies from whether that shipment had already reached `DELIVERED` — not asked of
   the caller, since the system already knows it.

See ADR-0008 for the full reasoning, including the two fields left unpopulated
(`packedById`, `handedToShippingById`) and why `Create Reshipment` now returns the
order to `READY_FOR_SHIPPING` instead of `SHIPPED`.

## 0. Grounding: what already exists

This design builds on modules already implemented, per `DECISIONS.md`:

- **Reference Data** (ADR-0003): `Currency`, `Country`, `Project`, `CostCenter`,
  `PaymentMethod`, `ShippingMethod`, `ProductCategory`, `ProductBrand`, `Warehouse`.
  All independent of each other and of CRM/Sales Orders. **Phase 2 adds one more:
  `ShippingCompany`** (decision #2 below) — Sales Orders needed it, so it was created
  alongside the core order module rather than as a separate task.
- **Identity** (ADR-0002): `User`, `Role`, `Permission`. No authentication yet.
- **CRM** (ADR-0005/0006): `Lead` reaches `PAID` via `POST /leads/:id/mark-paid`.
  `Lead.productId` is a **nullable UUID with no foreign key** — the Product module
  still doesn't exist; `SalesOrderItem.productId` mirrors this exactly.
- An established rule from CRM Phase 2 (ADR-0006): **"Lead is NOT a Customer... Customers
  will be created only after the first successful confirmed order."** Still true —
  decision #4 confirms this Sales Orders module does not create Customer records
  either.

---

## Phase 2 approved decisions (resolving the Phase 1 open questions)

| #   | Decision                                                                                                                                       | Resolves open question                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SalesOrderStatusHistory` is a dedicated, append-only table — never updated, never deleted. Every status transition creates a new row.         | 8.1 — **yes**, dedicated table, **and yes**, it deviates from ADR-0002's universal `deleted_at` convention: this table has no `updated_at`/`updated_by`/`deleted_at` at all, since those would contradict "never update, never delete."                                                                                                   |
| 2   | Shipping Company is a Reference Data entity — never free text.                                                                                 | 8.2 — resolved: new `ShippingCompany` model, same shape as `Warehouse`.                                                                                                                                                                                                                                                                   |
| 3   | Returns allowed before, during, and after delivery.                                                                                            | 8.3 — resolved: `returnOrder()` does not validate the current status; it's callable regardless of where the order is in its lifecycle.                                                                                                                                                                                                    |
| 4   | Customer records are not created here; orders reference Lead.                                                                                  | 8.6 — resolved: no Customer entity, `SalesOrder.leadId` is the only link. Customer integration is explicitly future work.                                                                                                                                                                                                                 |
| 5   | Pricing is a snapshot: Unit Price, Quantity, Discount, Offer, stored per line item; future product price changes never affect existing orders. | 8.7 — resolved: these four fields live on `SalesOrderItem` (not `SalesOrder` — pricing varies per product line, not per order). No computed line total or order total is introduced — not requested.                                                                                                                                      |
| 6   | Payment Method is mandatory.                                                                                                                   | 8.8 — resolved: `SalesOrder.paymentMethodId` is a required FK, decided at order creation (not retroactively on the Lead).                                                                                                                                                                                                                 |
| 7   | Warehouse is mandatory.                                                                                                                        | 8.9 — resolved: `SalesOrder.warehouseId` is a required FK.                                                                                                                                                                                                                                                                                |
| 8   | Sales Employee and Shipping Employee stored separately.                                                                                        | 8.10 — resolved: `SalesOrder.salesEmployeeId` (snapshot copy from the Lead at creation) and `SalesOrder.shippingEmployeeId` (nullable, set later via "Assign Shipping Employee") are two distinct FK columns to `User`.                                                                                                                   |
| 9   | Timeline ≠ Status History. Timeline records every important action.                                                                            | Refines 8.1 — confirms the general `SalesOrderActivity` timeline (open-ended string `type`, same pattern as `LeadActivity`) coexists with, and is distinct from, the strict `SalesOrderStatusHistory`.                                                                                                                                    |
| 10  | Attachments unlimited; each stores uploader, timestamp, type, description.                                                                     | Refines the Phase 1 `SalesOrderAttachment` design — `uploadedById` is a **required** FK (client-supplied, no auth to infer it — same precedent as `LeadNote.userId`), `createdAt` serves as "timestamp."                                                                                                                                  |
| 11  | Shipping cost: Base + Additional, Cost Paid By (Customer/Company).                                                                             | Refines Phase 1 (which only had "additional" cost) — both `baseShippingCost` and `additionalShippingCost` live on `Shipment`, per shipping attempt.                                                                                                                                                                                       |
| 12  | Sequential Order Number, independent from Lead Number.                                                                                         | Confirms Phase 1 design — own Postgres sequence, `SO-000001` style, mirroring `lead_number_seq`.                                                                                                                                                                                                                                          |
| 13  | Snapshot fields: Customer Name, Phone, Country, City, Address — never change after creation.                                                   | 8.11 — resolved: copied onto `SalesOrder`'s own columns at creation (not read through the `leadId` relation), so later edits to the Lead never affect them. Currency is copied the same way, by extension (not explicitly listed in decision #13, but the same reasoning applies and there's no other point where it would be specified). |
| 14  | Never physically delete Sales Orders.                                                                                                          | Consistent with the workspace-wide soft-delete convention already used everywhere (ADR-0002) — not a new rule, just a restatement. No delete/cancel operation was in the required list for this phase, so none was implemented (see §5).                                                                                                  |
| 15  | Reshipping never creates another order — it creates another Shipment under the same Sales Order.                                               | Confirms the Phase 1 `Shipment` sub-entity design (§3) was the right call.                                                                                                                                                                                                                                                                |

**Not resolved by an explicit decision** (still open, deferred to Phase 3 — see the
final blueprint section):

- 8.4 (is the return→reship loop bounded?) — not restricted; an order can be
  returned and reshipped multiple times, each reship creating a new `Shipment` row.
- 8.5 (Lead : Sales Order cardinality) — not constrained; nothing stops multiple
  orders referencing the same Lead.
- `ShippingMethod` linkage on `Shipment` — the approved decisions and required
  operations only mention **Shipping Company**, not Shipping Method. `Shipment` in
  this phase does **not** carry a `shippingMethodId`; only `shippingCompanyId`. This
  was in the Phase 1 draft and has been removed accordingly.

---

## 1. Order lifecycle

Unchanged from Phase 1 — the approved decisions refine _how it's persisted_, not the
workflow itself:

1. **Lead reaches PAID** (CRM, already implemented) — the trigger.
2. **Sales Order Created** — from the paid Lead, with mandatory Payment Method,
   Warehouse, Cost Center, Project, Currency, and at least one line item (Product
   placeholder ID + quantity + unit price + discount + offer snapshot).
3. **Ready for Shipping**
4. **Shipped** — a `Shipment` record now exists (Shipping Company, tracking number,
   optional label attachment, shipping cost).
5. **Delivered** (terminal) _or_ **Returned** — returnable at any point (decision #3).
6. **Reship (optional)** — a new `Shipment` row, same order, back to `SHIPPED`.
7. **Delivered** again, reusing the same terminal state.

---

## 2. State transition diagram (text)

```
                    [Lead: PAID]  (CRM, external trigger)
                          │
                          ▼
                ┌───────────────────┐
                │  CREATED          │
                └─────────┬─────────┘
                          │
                          ▼
                ┌───────────────────┐
                │  READY_FOR_       │
                │  SHIPPING         │
                └─────────┬─────────┘
                          │
                          ▼
                ┌───────────────────┐
      ┌────────►│  SHIPPED          │
      │         └─────────┬─────────┘
      │                   │
      │          ┌────────┴────────┐
      │          ▼                 ▼
      │ ┌────────────────┐  ┌────────────┐
      │ │  DELIVERED      │  │  RETURNED  │◄────┐
      │ │  (terminal)     │  └─────┬──────┘     │
      │ └───────┬────────┘        │            │
      │         │ (decision #3:    │ (optional  │
      │         │  return allowed  │  reship)   │
      │         │  even here)      ▼            │
      │         └─────────►┌────────────────┐   │
      │                    │  RETURNED      │───┘
      │                    └────────────────┘
      │                             │
      └─────────────────────────────┘
        (Create Reshipment → new Shipment row, status back to SHIPPED)
```

Every arrow into `READY_FOR_SHIPPING`, `SHIPPED`, `DELIVERED`, `RETURNED` writes one
`SalesOrderStatusHistory` row (`fromStatus` → `toStatus`) — permanent, never edited or
removed (decision #1). `RESHIP` is **not** a distinct `SalesOrderStatus` value — it's
an action that creates a new `Shipment` and transitions status back to `SHIPPED`,
consistent with how the original Phase 1 diagram treated it as an action, not a state.

---

## 3. Required database entities (as implemented)

All follow the ADR-0002 audit shape (UUID PK, snake_case, `created_at`/`updated_at`/
`created_by`/`updated_by`/`deleted_at`) **except** `SalesOrderStatusHistory`, which
deliberately omits `updated_at`/`updated_by`/`deleted_at` (decision #1).

| Entity                      | Purpose                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ShippingCompany**         | New Reference Data entity (decision #2). `code`/`name`/`description`, same shape as `Warehouse`.                                                                                                                                                                                                                                             |
| **SalesOrder**              | The order. `orderNumber` (own sequence), `leadId`, snapshot fields (`customerName`, `mobileNumber`, `countryId`, `city`, `address`, `currencyId`), `costCenterId`, `projectId`, `paymentMethodId` (mandatory), `warehouseId` (mandatory), `salesEmployeeId` (snapshot, nullable), `shippingEmployeeId` (nullable, assigned later), `status`. |
| **SalesOrderItem**          | Line items. `productId` (nullable, no FK), `quantity`, `unitPrice`, `discount`, `offer` — all snapshotted at creation (decision #5).                                                                                                                                                                                                         |
| **Shipment**                | One shipping attempt (original or reship). `shippingCompanyId` (FK), `trackingNumber`, `baseShippingCost`, `additionalShippingCost`, `costPaidBy` (enum), `isReship`.                                                                                                                                                                        |
| **SalesOrderAttachment**    | Unlimited attachments (decision #10), including shipping labels (tagged, linked to a `Shipment`). `uploadedById` (required FK), `attachmentType`, `description`, `fileUrl`/`fileName`.                                                                                                                                                       |
| **SalesOrderNote**          | Unlimited internal notes — append-only in this phase (create + list only, no edit/delete — narrower than `LeadNote`, since no update/delete operation was in the required list).                                                                                                                                                             |
| **SalesOrderActivity**      | General timeline (decision #9) — plain string `type`, same reasoning as `LeadActivity`.                                                                                                                                                                                                                                                      |
| **SalesOrderStatusHistory** | Dedicated append-only status log (decision #1). No delete, no update — enforced by simply not implementing those methods, not by a DB trigger.                                                                                                                                                                                               |

**Enum `SalesOrderStatus`**: `CREATED`, `READY_FOR_SHIPPING`, `SHIPPED`, `DELIVERED`,
`RETURNED`.
**Enum `ShippingCostPayer`**: `CUSTOMER`, `COMPANY`.

---

## 4. Relationships

```
Lead (1) ────────────────< SalesOrder (N)        -- unconstrained cardinality (8.5 still open)
Currency, CostCenter, Project, PaymentMethod,
Warehouse, Country (1 each) ──────< SalesOrder (N)
User (1) ─────< SalesOrder (N)   -- as salesEmployee (snapshot)
User (1) ─────< SalesOrder (N)   -- as shippingEmployee (separate FK, decision #8)

SalesOrder (1) ──< SalesOrderItem (N)
SalesOrder (1) ──< Shipment (N)                  -- reship = new row, decision #15
SalesOrder (1) ──< SalesOrderAttachment (N)
SalesOrder (1) ──< SalesOrderNote (N)
SalesOrder (1) ──< SalesOrderActivity (N)
SalesOrder (1) ──< SalesOrderStatusHistory (N)    -- never updated/deleted

ShippingCompany (1) ──< Shipment (N)
Shipment (1) ──< SalesOrderAttachment (0..N)      -- shipping label(s) for that shipment
User (1) ──< SalesOrderNote (N)                   -- note author
User (1) ──< SalesOrderAttachment (N)              -- uploader

SalesOrderItem.productId — nullable UUID, no FK (Product module still doesn't exist)
```

No relation to a `Customer` entity (decision #4).

---

## 5. Required business operations (implemented, not generic CRUD)

1. Create Order From Paid Lead — validates the Lead exists and is `PAID`.
2. Ready For Shipping
3. Assign Shipping Employee — validates the target `User` exists and is active (not
   soft-deleted) — same pattern as CRM's "active sales employee" check.
4. Assign Shipping Company — validates the target `ShippingCompany` exists and is
   active; creates the order's current `Shipment` row if one doesn't exist yet.
5. Add Tracking Number — on the current `Shipment`.
6. Upload Shipping Label — attachment tagged `SHIPPING_LABEL`, linked to the current
   `Shipment`.
7. Mark Shipped
8. Mark Delivered
9. Return Order — no status precondition (decision #3).
10. Create Reshipment — requires current status `RETURNED`; creates a new `Shipment`
    (`isReship = true`), status back to `SHIPPED`.
11. Add Shipping Cost — base + additional + payer, on the current `Shipment`.
12. Add Internal Note
13. Upload Attachment — generic, caller supplies `attachmentType`.

No generic `PATCH /sales-orders/:id` exists in this phase — every mutation is one of
the named operations above. No delete/cancel operation exists — not in the required
list (decision #14 only restates the existing no-hard-delete convention; it doesn't
imply a soft-delete/cancel operation must exist yet).

---

## 6. Required APIs (implemented)

```
POST   /sales-orders                              Create Order From Paid Lead
GET    /sales-orders
GET    /sales-orders/:id

POST   /sales-orders/:id/ready-for-shipping
POST   /sales-orders/:id/shipping-employee        Assign Shipping Employee
POST   /sales-orders/:id/shipping-company         Assign Shipping Company
POST   /sales-orders/:id/tracking-number          Add Tracking Number
POST   /sales-orders/:id/shipping-label           Upload Shipping Label
POST   /sales-orders/:id/ship                     Mark Shipped
POST   /sales-orders/:id/deliver                  Mark Delivered
POST   /sales-orders/:id/return                   Return Order
POST   /sales-orders/:id/reship                   Create Reshipment
POST   /sales-orders/:id/shipping-cost            Add Shipping Cost

GET    /sales-orders/:id/shipments
GET    /sales-orders/:id/status-history
GET    /sales-orders/:id/activities

POST   /sales-orders/:id/attachments              Upload Attachment (generic)
GET    /sales-orders/:id/attachments

POST   /sales-orders/:id/notes                    Add Internal Note
GET    /sales-orders/:id/notes
```

Plus standard Reference Data CRUD for the new `ShippingCompany` entity
(`/shipping-companies`), matching the other 9 reference-data modules exactly.

---

## 7. Future reports required from this module

Unchanged from Phase 1:

- Sales Order pipeline by status.
- Return rate, overall and per Shipping Company.
- Reship volume.
- Additional shipping cost, split by payer.
- Orders by Cost Center / Project / Currency.
- Lead-to-delivery cycle time.

---

## 8. Remaining open items (deferred to Phase 3, not decided here)

- Whether the return→reship cycle should ever be bounded (currently unlimited).
- Lead : Sales Order cardinality (currently unconstrained).
- Whether `ShippingMethod` (existing reference data) should also be linked on
  `Shipment` alongside `ShippingCompany` — not requested in Phase 2's decisions or
  required operations, so it wasn't added.
- Adding/removing `SalesOrderItem` rows after order creation (no operation for this
  was required — items are fixed at creation in this phase).
- Customer record creation — still entirely out of scope; no entity, no trigger point
  decided.
- Everything explicitly excluded from Phase 2: inventory deduction, accounting
  entries, invoice generation, reports, dashboard, payment reconciliation, warehouse
  stock movement.
