-- R14 W2 (spec-2 §B, decision D2-2) — assigning / changing a shipment's
-- shipping company and tracking (shipment) number is its own permission,
-- `shipping.assign_carrier`. Sales staff with only `store-orders.edit` lose
-- the carrier dialog they reached through a web gate bug; nobody who could
-- assign a carrier through the protected store-order endpoint loses it:
-- every INTERNAL holder of `shipping.edit` or `shipping.manage` receives it.
-- Additive and idempotent.
--
-- Reverse with: DELETE FROM user_permissions WHERE permission_id =
-- (SELECT id FROM permissions WHERE name = 'shipping.assign_carrier');
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'shipping.assign_carrier', 'Permission Matrix: shipping.assign_carrier', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'shipping.assign_carrier');

INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at", "effect")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP, 'GRANT'
FROM "users" u
CROSS JOIN (
  SELECT "id" FROM "permissions" WHERE "name" = 'shipping.assign_carrier'
) target
WHERE u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1
    FROM "user_permissions" held
    JOIN "permissions" hp ON hp."id" = held."permission_id"
    WHERE held."user_id" = u."id"
      AND held."effect" = 'GRANT'
      AND hp."name" IN ('shipping.edit', 'shipping.manage')
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
