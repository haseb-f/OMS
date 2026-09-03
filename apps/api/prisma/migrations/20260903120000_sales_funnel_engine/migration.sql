-- Sales Funnel Engine: distribution policy, RR cursor, assignment history,
-- structured follow-up, IN_PROGRESS workflow, StoreOrder source + owner index.

CREATE TYPE "LeadAssignmentMethod" AS ENUM ('AUTO_CONTINUOUS', 'AUTO_24H', 'MANUAL', 'REASSIGNMENT', 'IMPORT', 'SYSTEM');
CREATE TYPE "LeadDistributionMode" AS ENUM ('CONTINUOUS', 'TIME_LIMITED');
CREATE TYPE "LeadDistributionScope" AS ENUM ('COMPANY', 'TEAM', 'DEPARTMENT');

ALTER TYPE "StoreOrderSource" ADD VALUE IF NOT EXISTS 'EXCEL';
ALTER TYPE "StoreOrderSource" ADD VALUE IF NOT EXISTS 'GOOGLE_SHEETS';

ALTER TABLE "sales_teams" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "next_follow_up_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "first_opened_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leads_created_at_idx" ON "leads"("created_at");
CREATE INDEX IF NOT EXISTS "leads_country_id_idx" ON "leads"("country_id");
CREATE INDEX IF NOT EXISTS "leads_assigned_at_idx" ON "leads"("assigned_at");
CREATE INDEX IF NOT EXISTS "leads_next_follow_up_at_idx" ON "leads"("next_follow_up_at");
CREATE INDEX IF NOT EXISTS "leads_source_idx" ON "leads"("source");

ALTER TABLE "lead_assignments"
  ADD COLUMN IF NOT EXISTS "from_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "method" "LeadAssignmentMethod" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS "reason" TEXT,
  ADD COLUMN IF NOT EXISTS "actor_id" UUID;

CREATE INDEX IF NOT EXISTS "lead_assignments_lead_id_assigned_at_idx" ON "lead_assignments"("lead_id", "assigned_at");
CREATE INDEX IF NOT EXISTS "lead_assignments_assigned_to_id_idx" ON "lead_assignments"("assigned_to_id");

ALTER TABLE "lead_assignments"
  ADD CONSTRAINT "lead_assignments_from_user_id_fkey"
  FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lead_assignments"
  ADD CONSTRAINT "lead_assignments_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lead_follow_ups" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "outcome" TEXT,
    "note" TEXT,
    "follow_up_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_follow_ups_lead_id_created_at_idx" ON "lead_follow_ups"("lead_id", "created_at");
CREATE INDEX "lead_follow_ups_follow_up_at_idx" ON "lead_follow_ups"("follow_up_at");

ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lead_distribution_policies" (
    "id" UUID NOT NULL,
    "mode" "LeadDistributionMode" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "scope_type" "LeadDistributionScope" NOT NULL DEFAULT 'COMPANY',
    "team_id" UUID,
    "department_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "lead_distribution_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_distribution_policies_is_active_scope_type_expires_at_idx" ON "lead_distribution_policies"("is_active", "scope_type", "expires_at");
ALTER TABLE "lead_distribution_policies" ADD CONSTRAINT "lead_distribution_policies_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "sales_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lead_distribution_policies" ADD CONSTRAINT "lead_distribution_policies_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lead_distribution_states" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "last_assigned_employee_id" UUID,
    "cursor_position" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_distribution_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_distribution_states_policy_id_key" ON "lead_distribution_states"("policy_id");
ALTER TABLE "lead_distribution_states" ADD CONSTRAINT "lead_distribution_states_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "lead_distribution_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "store_orders_employee_id_idx" ON "store_orders"("employee_id");

-- IN_PROGRESS status + first-open / reopen transitions
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at")
SELECT gen_random_uuid(), 'LEAD', 'IN_PROGRESS', 'جاري المتابعة', 'In Progress', 'info', 1, true, false, false, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "status_definitions" WHERE "workflow_type" = 'LEAD' AND "code" = 'IN_PROGRESS' AND "deleted_at" IS NULL
);

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'بدء العمل', 'Start work', false, 'crm.leads.edit', 'NONE', true, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'NEW' AND t.workflow_type = 'LEAD' AND t.code = 'IN_PROGRESS'
AND NOT EXISTS (
  SELECT 1 FROM "workflow_transitions" wt
  WHERE wt.from_status_id = f.id AND wt.to_status_id = t.id AND wt.deleted_at IS NULL
);

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'متابعة', 'Follow Up', false, 'crm.leads.edit', 'NONE', false, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'IN_PROGRESS' AND t.workflow_type = 'LEAD' AND t.code = 'FOLLOW_UP'
AND NOT EXISTS (
  SELECT 1 FROM "workflow_transitions" wt
  WHERE wt.from_status_id = f.id AND wt.to_status_id = t.id AND wt.deleted_at IS NULL
);

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'تأهيل', 'Qualify', false, 'crm.leads.edit', 'NONE', false, 1, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'IN_PROGRESS' AND t.workflow_type = 'LEAD' AND t.code = 'QUALIFIED'
AND NOT EXISTS (
  SELECT 1 FROM "workflow_transitions" wt
  WHERE wt.from_status_id = f.id AND wt.to_status_id = t.id AND wt.deleted_at IS NULL
);

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'فقد العميل', 'Lost', true, 'crm.leads.edit', 'NONE', false, 2, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'IN_PROGRESS' AND t.workflow_type = 'LEAD' AND t.code = 'LOST'
AND NOT EXISTS (
  SELECT 1 FROM "workflow_transitions" wt
  WHERE wt.from_status_id = f.id AND wt.to_status_id = t.id AND wt.deleted_at IS NULL
);

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'غير مؤهل', 'Disqualify', true, 'crm.leads.edit', 'NONE', false, 3, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'IN_PROGRESS' AND t.workflow_type = 'LEAD' AND t.code = 'DISQUALIFIED'
AND NOT EXISTS (
  SELECT 1 FROM "workflow_transitions" wt
  WHERE wt.from_status_id = f.id AND wt.to_status_id = t.id AND wt.deleted_at IS NULL
);

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'إعادة فتح', 'Reopen', true, 'crm.leads.manage', 'NONE', false, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code IN ('LOST', 'DISQUALIFIED') AND t.workflow_type = 'LEAD' AND t.code = 'IN_PROGRESS'
AND NOT EXISTS (
  SELECT 1 FROM "workflow_transitions" wt
  WHERE wt.from_status_id = f.id AND wt.to_status_id = t.id AND wt.deleted_at IS NULL
);

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'تحويل إلى طلب', 'Convert to Order', false, 'crm.leads.convert', 'LEAD_CONVERT', true, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code IN ('IN_PROGRESS', 'FOLLOW_UP', 'QUALIFIED') AND t.workflow_type = 'LEAD' AND t.code = 'CONVERTED'
AND NOT EXISTS (
  SELECT 1 FROM "workflow_transitions" wt
  WHERE wt.from_status_id = f.id AND wt.to_status_id = t.id AND wt.deleted_at IS NULL
);
