# W4 — Customer discovery, repeat-order decisions, customer history

## 1. Advanced lookup and the existing-customer warning

Explicit owner change: an AUTHORIZED lookup (`customers.lookup_advanced`) now returns, per match:

- full customer name, full phone (E.164, displayed formatted), latest order number, a product summary
  (first 2 product names + "+N"), order date, coarse order status, placed-order count.
- Unchanged protections: permission granted to nobody by migration (owner grants deliberately), POST
  body, rate budget 15/10 min + 100/day, name search needs first + last name and returns nothing above
  5 matches, exact phone / order number up to 20 rows, agent data excluded, audit row per lookup
  (`GlobalLookupAudit`, new outcome detail `FULL_DISCLOSURE`). Opening a record still requires normal
  scope (search grants no edit/view rights); "not assigned to you" badge kept.
- Without `customers.lookup_advanced`, the order-entry duplicate warning keeps today's masked output.
- Order-creation duplicate panel (store order create, lead convert, agent order form): shows the same
  result card; the two choices are explicit buttons — "إنشاء طلب جديد لنفس العميل" (decision
  `INTENTIONAL_NEW_ORDER`, reuses the existing partner — never a second customer with the same
  normalized phone) and "إلغاء وعدم التكرار" (closes the dialog, nothing created).

## 2. Repeat-customer indicator

Definitions (one shared util `customer-order-stats.ts`):

- **placedOrders** = store orders of the partner excluding fulfillment `CANCELLED` (store orders have no
  draft state; B2B sales orders in DRAFT/CANCELLED excluded too).
- **completedPurchases** = fulfillment `DELIVERED` or `COLLECTED` and not `RETURNED`.
- Label "عميل متكرر · N طلبات" when placedOrders ≥ 2 (N = placedOrders); tooltip shows completed
  purchases. Shown on store-order detail, customer detail header, duplicate panel and lookup card.
- Counts are computed across the company (not the viewer's scope) but expose only the number.

## 3. Customer history

`GET /customers/:partnerId/history` (permission `customers.view`; scope = caller's sales scope):

- Orders (store + B2B) the caller can open: number, date, products summary, fulfillment and payment
  status, total, link. Orders outside scope appear only as a count ("N طلبات أخرى لدى موظفين آخرين").
- Payments/collections and outstanding balance only with `finance.view` or `customers.view_financials`
  (new, granted by migration to holders of `finance.view`); otherwise the section is hidden server-side.
- Chronological timeline (orders, deliveries, receipts, returns) with plain labels.
- Web: the customer page "orders" tab now lists store/B2B orders (it lists leads today); leads move to
  their own tab; a summary strip (placed, completed, last order date, outstanding if permitted).

## 4. Tests

Lookup returns full phone only with the permission; rate limit unchanged; agent isolation (agent user 403,
agent-only customers absent); history scope (other employee's order counted not listed); financial section
hidden without permission; duplicate decision reuses the partner.
