-- R16 (owner, 2026-10-10): importing orders is available to sales employees,
-- company and agent alike.
--
-- * Company side needs no data: `store-orders.create` now implies
--   `store-orders.import` at resolve time (permission-catalog
--   `withImpliedSectionPermissions`), so every current and future employee who
--   may create store orders may import them; an individual DENY still revokes it.
-- * Agent side: `agent.orders.import` joins the agent SALES preset; existing,
--   not-deleted agent SALES users receive it here (ADMIN users already hold it
--   since 20261009100400_r15_sales_imports). Additive and idempotent.
--
-- Reverse with: DELETE FROM user_permissions up USING users u, permissions p
-- WHERE up.user_id = u.id AND up.permission_id = p.id AND u.user_type = 'AGENT'
-- AND u.agent_role = 'SALES' AND p.name = 'agent.orders.import';
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at", "effect")
SELECT gen_random_uuid(), u."id", p."id", CURRENT_TIMESTAMP, 'GRANT'
FROM "users" u
CROSS JOIN "permissions" p
WHERE u."user_type" = 'AGENT'
  AND u."agent_role" = 'SALES'
  AND u."deleted_at" IS NULL
  AND p."name" = 'agent.orders.import'
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
