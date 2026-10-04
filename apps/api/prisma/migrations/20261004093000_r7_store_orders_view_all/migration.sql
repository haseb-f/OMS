-- Round 7 review follow-up — explicit cross-owner browse grant for Store Orders.
-- `store-orders.manage` is an action right that ordinary sales staff hold in
-- real tenants (payment-review status / declaration corrections); it must not
-- widen their scope to every order. The wide view is now its own catalog row,
-- granted to NOBODY here: Super Admin bypasses every check, a company-wide
-- `crm.leads.manage` supervisor keeps the full view, anyone else is granted it
-- explicitly in the Permission Matrix. Additive only; no data is changed.
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'store-orders.view_all', 'Permission Matrix: store-orders.view_all', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'store-orders.view_all');
