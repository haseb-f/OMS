-- Round 11 — advanced customer lookup is no longer administrator-only.
--
-- R7 created `customers.lookup_advanced` and granted it to NOBODY (Super Admin
-- bypasses), so in practice only an administrator could discover a customer
-- owned by another employee — the staff who actually take the calls could not.
-- Owner instruction (R11): make it available to the employees who handle
-- customers and orders, as an explicit, revocable Permission Matrix grant.
--
-- Who receives it (additive, idempotent, never removes a grant): every ACTIVE,
-- not-locked, not-deleted INTERNAL user who can already create an order or
-- convert a lead (`store-orders.create` / `crm.leads.convert`), or who already
-- holds a legacy discovery right (`customers.lookup_global` /
-- `orders.lookup_global`). Agent users are never granted it (the lookup is an
-- internal-data tool; agents search inside their own scope). The right grants
-- DISCOVERY only — masked phone, two letters per name word, reference + coarse
-- status, never an edit/reassign/post right — and stays inside the shared
-- audited per-user rate budget (15 / 10 min, 100 / day).
--
-- Reverse with: DELETE FROM user_permissions WHERE permission_id =
-- (SELECT id FROM permissions WHERE name = 'customers.lookup_advanced')
-- AND created_by IS NULL AND created_at >= '2026-10-05'.
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN (
  SELECT "id" FROM "permissions" WHERE "name" = 'customers.lookup_advanced'
) target
WHERE u."deleted_at" IS NULL
  AND u."is_active" = true
  AND u."is_locked" = false
  AND u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1
    FROM "user_permissions" held
    JOIN "permissions" hp ON hp."id" = held."permission_id"
    WHERE held."user_id" = u."id"
      AND hp."name" IN (
        'store-orders.create',
        'crm.leads.convert',
        'customers.lookup_global',
        'orders.lookup_global'
      )
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
