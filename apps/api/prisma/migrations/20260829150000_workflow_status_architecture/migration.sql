-- Dynamic Workflow + Status Master Data foundation.
-- Migrates Lead.status enum to status_id FK on status_definitions.

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('LEAD', 'ORDER', 'PAYMENT', 'FULFILLMENT', 'MATCHING', 'RECONCILIATION');
CREATE TYPE "StatusChangeSource" AS ENUM ('USER', 'IMPORT', 'SYSTEM', 'MATCHING_ENGINE', 'SHIPPING_SYNC', 'WORKFLOW_ENGINE');
CREATE TYPE "WorkflowApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "WorkflowBusinessAction" AS ENUM ('NONE', 'LEAD_CONVERT', 'PAYMENT_RECONCILE', 'SHIPMENT_CREATE');

-- CreateTable status_definitions
CREATE TABLE "status_definitions" (
    "id" UUID NOT NULL,
    "workflow_type" "WorkflowType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "color" TEXT NOT NULL DEFAULT 'neutral',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "status_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "status_definitions_workflow_type_code_key" ON "status_definitions"("workflow_type", "code");
CREATE INDEX "status_definitions_workflow_type_deleted_at_sort_order_idx" ON "status_definitions"("workflow_type", "deleted_at", "sort_order");

-- Seed LEAD statuses (stable codes — display names/colors are admin-editable)
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at") VALUES
  (gen_random_uuid(), 'LEAD', 'NEW', 'جديد', 'New', 'neutral', 0, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEAD', 'ASSIGNED', 'مُعيَّن', 'Assigned', 'info', 1, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEAD', 'CONTACTED', 'تم التواصل', 'Contacted', 'info', 2, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEAD', 'FOLLOW_UP', 'متابعة', 'Follow Up', 'warning', 3, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEAD', 'QUALIFIED', 'مؤهل', 'Qualified', 'success', 4, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEAD', 'CONVERTED', 'تم التحويل', 'Converted', 'success', 5, true, true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEAD', 'LOST', 'فقد العميل', 'Lost', 'destructive', 6, true, true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEAD', 'DISQUALIFIED', 'غير مؤهل', 'Disqualified', 'neutral', 7, true, true, false, CURRENT_TIMESTAMP);

-- ORDER workflow statuses
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at") VALUES
  (gen_random_uuid(), 'ORDER', 'DRAFT', 'مسودة', 'Draft', 'neutral', 0, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER', 'CONFIRMED', 'مؤكد', 'Confirmed', 'info', 1, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER', 'CANCELLED', 'ملغي', 'Cancelled', 'destructive', 2, true, true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER', 'COMPLETED', 'مكتمل', 'Completed', 'success', 3, true, true, false, CURRENT_TIMESTAMP);

-- PAYMENT workflow statuses
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at") VALUES
  (gen_random_uuid(), 'PAYMENT', 'UNPAID', 'غير مدفوع', 'Unpaid', 'neutral', 0, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT', 'PAYMENT_REPORTED', 'تم الإبلاغ عن الدفع', 'Payment Reported', 'warning', 1, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT', 'PARTIALLY_PAID', 'مدفوع جزئياً', 'Partially Paid', 'warning', 2, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT', 'PAID', 'مدفوع', 'Paid', 'success', 3, true, true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT', 'PARTIALLY_REFUNDED', 'مسترد جزئياً', 'Partially Refunded', 'warning', 4, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT', 'REFUNDED', 'مسترد', 'Refunded', 'neutral', 5, true, true, false, CURRENT_TIMESTAMP);

-- FULFILLMENT workflow statuses
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at") VALUES
  (gen_random_uuid(), 'FULFILLMENT', 'UNFULFILLED', 'غير منفّذ', 'Unfulfilled', 'neutral', 0, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FULFILLMENT', 'READY', 'جاهز', 'Ready', 'info', 1, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FULFILLMENT', 'PROCESSING', 'قيد المعالجة', 'Processing', 'info', 2, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FULFILLMENT', 'SHIPPED', 'تم الشحن', 'Shipped', 'info', 3, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FULFILLMENT', 'DELIVERED', 'تم التسليم', 'Delivered', 'success', 4, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FULFILLMENT', 'FAILED', 'فشل', 'Failed', 'destructive', 5, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FULFILLMENT', 'RETURNED', 'مرتجع', 'Returned', 'warning', 6, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FULFILLMENT', 'CANCELLED', 'ملغي', 'Cancelled', 'destructive', 7, true, true, false, CURRENT_TIMESTAMP);

-- MATCHING workflow statuses
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at") VALUES
  (gen_random_uuid(), 'MATCHING', 'UNMATCHED', 'غير مطابق', 'Unmatched', 'neutral', 0, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MATCHING', 'CANDIDATE', 'مطابقة محتملة', 'Candidate', 'warning', 1, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MATCHING', 'REVIEW', 'مراجعة', 'Review', 'warning', 2, true, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MATCHING', 'MATCHED', 'مطابق', 'Matched', 'success', 3, true, true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MATCHING', 'REJECTED', 'مرفوض', 'Rejected', 'destructive', 4, true, true, false, CURRENT_TIMESTAMP);

-- CreateTable workflow_transitions
CREATE TABLE "workflow_transitions" (
    "id" UUID NOT NULL,
    "workflow_type" "WorkflowType" NOT NULL,
    "from_status_id" UUID NOT NULL,
    "to_status_id" UUID NOT NULL,
    "label_ar" TEXT NOT NULL,
    "label_en" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "requires_reason" BOOLEAN NOT NULL DEFAULT false,
    "required_permission" TEXT,
    "business_action" "WorkflowBusinessAction" NOT NULL DEFAULT 'NONE',
    "is_system_protected" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_transitions_workflow_type_from_status_id_is_active_idx" ON "workflow_transitions"("workflow_type", "from_status_id", "is_active");

-- Seed LEAD transitions (using status code lookups)
INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'تواصل', 'Contact', false, 'crm.leads.edit', 'NONE', false, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'NEW' AND t.workflow_type = 'LEAD' AND t.code = 'CONTACTED';

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'متابعة', 'Follow Up', false, 'crm.leads.edit', 'NONE', false, 1, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'NEW' AND t.workflow_type = 'LEAD' AND t.code = 'FOLLOW_UP';

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'متابعة', 'Follow Up', false, 'crm.leads.edit', 'NONE', false, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'CONTACTED' AND t.workflow_type = 'LEAD' AND t.code = 'FOLLOW_UP';

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'تأهيل', 'Qualify', false, 'crm.leads.edit', 'NONE', false, 1, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'CONTACTED' AND t.workflow_type = 'LEAD' AND t.code = 'QUALIFIED';

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'تأهيل', 'Qualify', false, 'crm.leads.edit', 'NONE', false, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'FOLLOW_UP' AND t.workflow_type = 'LEAD' AND t.code = 'QUALIFIED';

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'تحويل إلى طلب', 'Convert to Order', false, 'crm.leads.convert', 'LEAD_CONVERT', true, 0, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code = 'QUALIFIED' AND t.workflow_type = 'LEAD' AND t.code = 'CONVERTED';

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'فقد العميل', 'Lost', true, 'crm.leads.edit', 'NONE', false, 1, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code IN ('CONTACTED', 'FOLLOW_UP', 'QUALIFIED') AND t.workflow_type = 'LEAD' AND t.code = 'LOST';

INSERT INTO "workflow_transitions" ("id", "workflow_type", "from_status_id", "to_status_id", "label_ar", "label_en", "requires_reason", "required_permission", "business_action", "is_system_protected", "sort_order", "updated_at")
SELECT gen_random_uuid(), 'LEAD', f.id, t.id, 'غير مؤهل', 'Disqualify', true, 'crm.leads.edit', 'NONE', false, 2, CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE f.workflow_type = 'LEAD' AND f.code IN ('NEW', 'CONTACTED', 'FOLLOW_UP') AND t.workflow_type = 'LEAD' AND t.code = 'DISQUALIFIED';

-- CreateTable status_history
CREATE TABLE "status_history" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_status_id" UUID,
    "to_status_id" UUID NOT NULL,
    "transition_id" UUID,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "source" "StatusChangeSource" NOT NULL DEFAULT 'USER',

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "status_history_entity_type_entity_id_changed_at_idx" ON "status_history"("entity_type", "entity_id", "changed_at");

-- CreateTable workflow_approvals
CREATE TABLE "workflow_approvals" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "transition_id" UUID NOT NULL,
    "from_status_id" UUID NOT NULL,
    "to_status_id" UUID NOT NULL,
    "status" "WorkflowApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_approvals_entity_type_entity_id_status_idx" ON "workflow_approvals"("entity_type", "entity_id", "status");
CREATE INDEX "workflow_approvals_status_requested_at_idx" ON "workflow_approvals"("status", "requested_at");

-- AlterTable leads: add status_id only (store_order link lives on store_orders.lead_id)
ALTER TABLE "leads" ADD COLUMN "status_id" UUID;

-- Backfill status_id from legacy LeadStatus enum
UPDATE "leads" l SET "status_id" = sd.id
FROM "status_definitions" sd
WHERE sd.workflow_type = 'LEAD' AND sd.code = CASE l.status::text
  WHEN 'NEW' THEN 'NEW'
  WHEN 'UNDER_FOLLOW_UP' THEN 'FOLLOW_UP'
  WHEN 'PAID' THEN 'QUALIFIED'
  WHEN 'ARCHIVED' THEN 'LOST'
  ELSE 'NEW'
END;

-- Default any nulls to NEW
UPDATE "leads" l SET "status_id" = sd.id
FROM "status_definitions" sd
WHERE l.status_id IS NULL AND sd.workflow_type = 'LEAD' AND sd.code = 'NEW';

ALTER TABLE "leads" ALTER COLUMN "status_id" SET NOT NULL;

-- AlterTable store_orders: add lead_id (unique — one conversion per lead)
ALTER TABLE "store_orders" ADD COLUMN "lead_id" UUID;

-- Drop legacy LeadStatus column and enum
ALTER TABLE "leads" DROP COLUMN "status";
DROP TYPE "LeadStatus";

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "status_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "status_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "status_history" ADD CONSTRAINT "status_history_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "status_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "status_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "workflow_transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "workflow_transitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "status_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "status_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads" ADD CONSTRAINT "leads_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "status_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "store_orders_lead_id_key" ON "store_orders"("lead_id");
CREATE INDEX "leads_status_id_idx" ON "leads"("status_id");
CREATE INDEX "leads_sales_employee_id_status_id_idx" ON "leads"("sales_employee_id", "status_id");
