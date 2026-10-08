-- R15 (decisions D15-16, D15-17) — permission-controlled lead / store-order
-- imports for company and agent sales users, from Excel or a connected private
-- Google Sheet.
--
-- * import_jobs.agent_id — an agent user's import (agent from the token, never
--   the file); jobs become private to their creator (enforced in the service).
-- * leads.import_row_key (unique) — the imported row's identity, shared by the
--   one-time import and the Google Sheets sync (never ingested twice).
-- * import_sheet_connections — a private spreadsheet connected (via the OMS
--   service account, never public) and owned by one user or one agent.
-- * Permissions: crm.leads.import, store-orders.import (company; granted to
--   nobody — the owner grants them, super admin bypasses);
--   agent.leads.import, agent.orders.import, agent.records.assign,
--   agent.reports.view_team (agent; granted to every existing agent ADMIN user
--   so they can use and delegate them — same as the ADMIN preset for new ones).
--
-- Additive. Reverse with: DROP TABLE import_sheet_connections; drop
-- leads.import_row_key, import_jobs.agent_id; DELETE the six permissions.

-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN "agent_id" UUID;

-- CreateIndex
CREATE INDEX "import_jobs_created_by_created_at_idx" ON "import_jobs"("created_by", "created_at");
CREATE INDEX "import_jobs_agent_id_created_at_idx" ON "import_jobs"("agent_id", "created_at");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "import_row_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_import_row_key_key" ON "leads"("import_row_key");

-- CreateTable
CREATE TABLE "import_sheet_connections" (
    "id" UUID NOT NULL,
    "spreadsheet_id" TEXT NOT NULL,
    "title" TEXT,
    "owner_user_id" UUID,
    "agent_id" UUID,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "import_sheet_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_sheet_connections_spreadsheet_id_key" ON "import_sheet_connections"("spreadsheet_id");
CREATE INDEX "import_sheet_connections_owner_user_id_idx" ON "import_sheet_connections"("owner_user_id");
CREATE INDEX "import_sheet_connections_agent_id_idx" ON "import_sheet_connections"("agent_id");

-- AddForeignKey
ALTER TABLE "import_sheet_connections" ADD CONSTRAINT "import_sheet_connections_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions.
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), p.name, 'Permission Matrix: ' || p.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('crm.leads.import'),
  ('store-orders.import'),
  ('agent.leads.import'),
  ('agent.orders.import'),
  ('agent.records.assign'),
  ('agent.reports.view_team')
) AS p(name)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" existing WHERE existing."name" = p.name);

-- Existing agent administrators receive the four agent keys (ADMIN preset).
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at", "effect")
SELECT gen_random_uuid(), u."id", p."id", CURRENT_TIMESTAMP, 'GRANT'
FROM "users" u
CROSS JOIN "permissions" p
WHERE u."user_type" = 'AGENT'
  AND u."agent_role" = 'ADMIN'
  AND u."deleted_at" IS NULL
  AND p."name" IN ('agent.leads.import', 'agent.orders.import', 'agent.records.assign', 'agent.reports.view_team')
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
