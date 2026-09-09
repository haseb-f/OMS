-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PayrollComponentType" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "PayrollComponentCalculationType" AS ENUM ('FIXED', 'PERCENTAGE', 'VARIABLE');

-- CreateEnum
CREATE TYPE "KpiItemType" AS ENUM ('YES_NO', 'PERCENTAGE', 'RATING_1_TO_5', 'DROPDOWN', 'AUTO_METRIC');

-- CreateEnum
CREATE TYPE "KpiEvaluatorSource" AS ENUM ('MANAGER', 'HR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "KpiAutoMetricSource" AS ENUM ('SALES_TARGET_ACHIEVEMENT');

-- CreateEnum
CREATE TYPE "KpiEvaluationStatus" AS ENUM ('DRAFT', 'MANAGER_SUBMITTED', 'HR_APPROVED', 'INCLUDED_IN_PAYROLL');

-- CreateEnum
CREATE TYPE "KpiAssignmentScope" AS ENUM ('EMPLOYEE', 'JOB_TITLE', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "TargetScopeType" AS ENUM ('EMPLOYEE', 'TEAM');

-- CreateEnum
CREATE TYPE "TargetMetric" AS ENUM ('SALES_REVENUE', 'COLLECTED_SALES', 'ORDERS_COUNT');

-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('COLLECTED_SALES', 'SALES_REVENUE', 'ORDERS_COUNT');

-- CreateEnum
CREATE TYPE "CommissionRuleType" AS ENUM ('FLAT_PERCENTAGE', 'ACHIEVEMENT_TIER', 'FIXED_BONUS');

-- CreateEnum
CREATE TYPE "CommissionAssignmentScope" AS ENUM ('EMPLOYEE', 'TEAM', 'DEPARTMENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('CALCULATED', 'APPROVED', 'INCLUDED_IN_PAYROLL', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'HR_REVIEWED', 'FINANCE_APPROVED', 'POSTED', 'PAID');

-- AlterTable
ALTER TABLE "employee_profiles" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "employee_code" TEXT NOT NULL,
ADD COLUMN     "employment_status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "hire_date" DATE,
ADD COLUMN     "manager_employee_id" UUID,
ADD COLUMN     "sales_team_id" UUID,
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "commission_expense_account_id" UUID,
ADD COLUMN     "default_allowance_expense_account_id" UUID,
ADD COLUMN     "default_deduction_account_id" UUID,
ADD COLUMN     "kpi_expense_account_id" UUID,
ADD COLUMN     "payroll_payable_account_id" UUID,
ADD COLUMN     "salary_expense_account_id" UUID;

-- CreateTable
CREATE TABLE "payroll_components" (
    "id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "type" "PayrollComponentType" NOT NULL,
    "calculation_type" "PayrollComponentCalculationType" NOT NULL DEFAULT 'FIXED',
    "default_value" DECIMAL(12,2),
    "accounting_mapping_account_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payroll_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensation_revisions" (
    "id" UUID NOT NULL,
    "employee_profile_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "basic_salary" DECIMAL(12,2) NOT NULL,
    "kpi_max_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "compensation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensation_revision_lines" (
    "id" UUID NOT NULL,
    "compensation_revision_id" UUID NOT NULL,
    "payroll_component_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "compensation_revision_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "kpi_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_template_items" (
    "id" UUID NOT NULL,
    "kpi_template_id" UUID NOT NULL,
    "criterion_ar" TEXT NOT NULL,
    "criterion_en" TEXT,
    "weight" DECIMAL(5,2) NOT NULL,
    "item_type" "KpiItemType" NOT NULL,
    "evaluator_source" "KpiEvaluatorSource" NOT NULL,
    "auto_metric_source" "KpiAutoMetricSource",
    "dropdown_options" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "kpi_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_template_assignments" (
    "id" UUID NOT NULL,
    "kpi_template_id" UUID NOT NULL,
    "scope" "KpiAssignmentScope" NOT NULL,
    "job_title_id" UUID,
    "department_id" UUID,
    "employee_profile_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "kpi_template_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_evaluations" (
    "id" UUID NOT NULL,
    "employee_profile_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "kpi_template_id" UUID NOT NULL,
    "status" "KpiEvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "kpi_max_pay_snapshot" DECIMAL(12,2) NOT NULL,
    "final_score" DECIMAL(5,2),
    "kpi_pay" DECIMAL(12,2),
    "manager_submitted_by_user_id" UUID,
    "manager_submitted_at" TIMESTAMP(3),
    "hr_approved_by_user_id" UUID,
    "hr_approved_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "reopened_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "kpi_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_evaluation_items" (
    "id" UUID NOT NULL,
    "kpi_evaluation_id" UUID NOT NULL,
    "kpi_template_item_id" UUID NOT NULL,
    "criterion_ar_snapshot" TEXT NOT NULL,
    "weight_snapshot" DECIMAL(5,2) NOT NULL,
    "item_type_snapshot" "KpiItemType" NOT NULL,
    "evaluator_source_snapshot" "KpiEvaluatorSource" NOT NULL,
    "raw_value" JSONB,
    "normalized_score" DECIMAL(5,2),
    "weighted_score" DECIMAL(5,2),
    "comment" TEXT,
    "evaluated_by_user_id" UUID,
    "evaluated_at" TIMESTAMP(3),

    CONSTRAINT "kpi_evaluation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_evaluation_audit_logs" (
    "id" UUID NOT NULL,
    "kpi_evaluation_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "previous_status" "KpiEvaluationStatus",
    "new_status" "KpiEvaluationStatus",
    "reason" TEXT,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_evaluation_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "scope_type" "TargetScopeType" NOT NULL,
    "employee_profile_id" UUID,
    "sales_team_id" UUID,
    "metric" "TargetMetric" NOT NULL DEFAULT 'COLLECTED_SALES',
    "target_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "basis" "CommissionBasis" NOT NULL DEFAULT 'COLLECTED_SALES',
    "rule_type" "CommissionRuleType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "commission_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plan_tiers" (
    "id" UUID NOT NULL,
    "commission_plan_id" UUID NOT NULL,
    "min_achievement_percent" DECIMAL(6,2) NOT NULL,
    "max_achievement_percent" DECIMAL(6,2),
    "percentage" DECIMAL(6,3),
    "fixed_amount" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "commission_plan_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plan_assignments" (
    "id" UUID NOT NULL,
    "commission_plan_id" UUID NOT NULL,
    "scope" "CommissionAssignmentScope" NOT NULL,
    "employee_profile_id" UUID,
    "sales_team_id" UUID,
    "department_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "commission_plan_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_calculations" (
    "id" UUID NOT NULL,
    "employee_profile_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "commission_plan_id" UUID NOT NULL,
    "basis_amount" DECIMAL(14,2) NOT NULL,
    "target_amount" DECIMAL(14,2),
    "achievement_percent" DECIMAL(6,2),
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'CALCULATED',
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_adjustments" (
    "id" UUID NOT NULL,
    "origin_commission_calculation_id" UUID NOT NULL,
    "target_period" VARCHAR(7) NOT NULL,
    "previous_amount" DECIMAL(12,2) NOT NULL,
    "new_amount" DECIMAL(12,2) NOT NULL,
    "amount_delta" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_to_payroll_line_id" UUID,

    CONSTRAINT "commission_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "hr_reviewed_by_user_id" UUID,
    "hr_reviewed_at" TIMESTAMP(3),
    "finance_approved_by_user_id" UUID,
    "finance_approved_at" TIMESTAMP(3),
    "posted_by_user_id" UUID,
    "posted_at" TIMESTAMP(3),
    "paid_by_user_id" UUID,
    "paid_at" TIMESTAMP(3),
    "gross_earnings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "employee_profile_id" UUID NOT NULL,
    "basic_salary" DECIMAL(12,2) NOT NULL,
    "kpi_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_earnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross_earnings" DECIMAL(12,2) NOT NULL,
    "net_pay" DECIMAL(12,2) NOT NULL,
    "kpi_evaluation_id" UUID,
    "commission_calculation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_line_components" (
    "id" UUID NOT NULL,
    "payroll_line_id" UUID NOT NULL,
    "payroll_component_id" UUID,
    "label" TEXT NOT NULL,
    "type" "PayrollComponentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_line_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_components_deleted_at_is_active_type_sort_order_idx" ON "payroll_components"("deleted_at", "is_active", "type", "sort_order");

-- CreateIndex
CREATE INDEX "compensation_revisions_employee_profile_id_effective_from_idx" ON "compensation_revisions"("employee_profile_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "compensation_revisions_employee_profile_id_effective_from_key" ON "compensation_revisions"("employee_profile_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "compensation_revision_lines_compensation_revision_id_payrol_key" ON "compensation_revision_lines"("compensation_revision_id", "payroll_component_id");

-- CreateIndex
CREATE INDEX "kpi_templates_deleted_at_is_active_sort_order_idx" ON "kpi_templates"("deleted_at", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "kpi_template_items_kpi_template_id_sort_order_idx" ON "kpi_template_items"("kpi_template_id", "sort_order");

-- CreateIndex
CREATE INDEX "kpi_template_assignments_scope_job_title_id_idx" ON "kpi_template_assignments"("scope", "job_title_id");

-- CreateIndex
CREATE INDEX "kpi_template_assignments_scope_department_id_idx" ON "kpi_template_assignments"("scope", "department_id");

-- CreateIndex
CREATE INDEX "kpi_template_assignments_scope_employee_profile_id_idx" ON "kpi_template_assignments"("scope", "employee_profile_id");

-- CreateIndex
CREATE INDEX "kpi_evaluations_status_period_idx" ON "kpi_evaluations"("status", "period");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_evaluations_employee_profile_id_period_key" ON "kpi_evaluations"("employee_profile_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_evaluation_items_kpi_evaluation_id_kpi_template_item_id_key" ON "kpi_evaluation_items"("kpi_evaluation_id", "kpi_template_item_id");

-- CreateIndex
CREATE INDEX "kpi_evaluation_audit_logs_kpi_evaluation_id_created_at_idx" ON "kpi_evaluation_audit_logs"("kpi_evaluation_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_targets_period_scope_type_idx" ON "sales_targets"("period", "scope_type");

-- CreateIndex
CREATE UNIQUE INDEX "sales_targets_period_employee_profile_id_metric_key" ON "sales_targets"("period", "employee_profile_id", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "sales_targets_period_sales_team_id_metric_key" ON "sales_targets"("period", "sales_team_id", "metric");

-- CreateIndex
CREATE INDEX "commission_plans_deleted_at_is_active_idx" ON "commission_plans"("deleted_at", "is_active");

-- CreateIndex
CREATE INDEX "commission_plan_tiers_commission_plan_id_min_achievement_pe_idx" ON "commission_plan_tiers"("commission_plan_id", "min_achievement_percent");

-- CreateIndex
CREATE INDEX "commission_plan_assignments_scope_employee_profile_id_idx" ON "commission_plan_assignments"("scope", "employee_profile_id");

-- CreateIndex
CREATE INDEX "commission_plan_assignments_scope_sales_team_id_idx" ON "commission_plan_assignments"("scope", "sales_team_id");

-- CreateIndex
CREATE INDEX "commission_plan_assignments_scope_department_id_idx" ON "commission_plan_assignments"("scope", "department_id");

-- CreateIndex
CREATE INDEX "commission_calculations_status_period_idx" ON "commission_calculations"("status", "period");

-- CreateIndex
CREATE UNIQUE INDEX "commission_calculations_employee_profile_id_period_key" ON "commission_calculations"("employee_profile_id", "period");

-- CreateIndex
CREATE INDEX "commission_adjustments_target_period_idx" ON "commission_adjustments"("target_period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_period_key" ON "payroll_runs"("period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_kpi_evaluation_id_key" ON "payroll_lines"("kpi_evaluation_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_commission_calculation_id_key" ON "payroll_lines"("commission_calculation_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_payroll_run_id_employee_profile_id_key" ON "payroll_lines"("payroll_run_id", "employee_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_employee_code_key" ON "employee_profiles"("employee_code");

-- CreateIndex
CREATE INDEX "employee_profiles_deleted_at_employment_status_idx" ON "employee_profiles"("deleted_at", "employment_status");

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_sales_team_id_fkey" FOREIGN KEY ("sales_team_id") REFERENCES "sales_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_manager_employee_id_fkey" FOREIGN KEY ("manager_employee_id") REFERENCES "employee_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_payroll_payable_account_id_fkey" FOREIGN KEY ("payroll_payable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_salary_expense_account_id_fkey" FOREIGN KEY ("salary_expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_kpi_expense_account_id_fkey" FOREIGN KEY ("kpi_expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_commission_expense_account_id_fkey" FOREIGN KEY ("commission_expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_default_allowance_expense_account_id_fkey" FOREIGN KEY ("default_allowance_expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_default_deduction_account_id_fkey" FOREIGN KEY ("default_deduction_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_accounting_mapping_account_id_fkey" FOREIGN KEY ("accounting_mapping_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_revisions" ADD CONSTRAINT "compensation_revisions_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_revision_lines" ADD CONSTRAINT "compensation_revision_lines_compensation_revision_id_fkey" FOREIGN KEY ("compensation_revision_id") REFERENCES "compensation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_revision_lines" ADD CONSTRAINT "compensation_revision_lines_payroll_component_id_fkey" FOREIGN KEY ("payroll_component_id") REFERENCES "payroll_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template_items" ADD CONSTRAINT "kpi_template_items_kpi_template_id_fkey" FOREIGN KEY ("kpi_template_id") REFERENCES "kpi_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template_assignments" ADD CONSTRAINT "kpi_template_assignments_kpi_template_id_fkey" FOREIGN KEY ("kpi_template_id") REFERENCES "kpi_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template_assignments" ADD CONSTRAINT "kpi_template_assignments_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template_assignments" ADD CONSTRAINT "kpi_template_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template_assignments" ADD CONSTRAINT "kpi_template_assignments_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "employee_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_evaluations" ADD CONSTRAINT "kpi_evaluations_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_evaluations" ADD CONSTRAINT "kpi_evaluations_kpi_template_id_fkey" FOREIGN KEY ("kpi_template_id") REFERENCES "kpi_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_evaluation_items" ADD CONSTRAINT "kpi_evaluation_items_kpi_evaluation_id_fkey" FOREIGN KEY ("kpi_evaluation_id") REFERENCES "kpi_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_evaluation_items" ADD CONSTRAINT "kpi_evaluation_items_kpi_template_item_id_fkey" FOREIGN KEY ("kpi_template_item_id") REFERENCES "kpi_template_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_evaluation_audit_logs" ADD CONSTRAINT "kpi_evaluation_audit_logs_kpi_evaluation_id_fkey" FOREIGN KEY ("kpi_evaluation_id") REFERENCES "kpi_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "employee_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_sales_team_id_fkey" FOREIGN KEY ("sales_team_id") REFERENCES "sales_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plan_tiers" ADD CONSTRAINT "commission_plan_tiers_commission_plan_id_fkey" FOREIGN KEY ("commission_plan_id") REFERENCES "commission_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plan_assignments" ADD CONSTRAINT "commission_plan_assignments_commission_plan_id_fkey" FOREIGN KEY ("commission_plan_id") REFERENCES "commission_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plan_assignments" ADD CONSTRAINT "commission_plan_assignments_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "employee_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plan_assignments" ADD CONSTRAINT "commission_plan_assignments_sales_team_id_fkey" FOREIGN KEY ("sales_team_id") REFERENCES "sales_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plan_assignments" ADD CONSTRAINT "commission_plan_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_calculations" ADD CONSTRAINT "commission_calculations_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_calculations" ADD CONSTRAINT "commission_calculations_commission_plan_id_fkey" FOREIGN KEY ("commission_plan_id") REFERENCES "commission_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_origin_commission_calculation_id_fkey" FOREIGN KEY ("origin_commission_calculation_id") REFERENCES "commission_calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_kpi_evaluation_id_fkey" FOREIGN KEY ("kpi_evaluation_id") REFERENCES "kpi_evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_commission_calculation_id_fkey" FOREIGN KEY ("commission_calculation_id") REFERENCES "commission_calculations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line_components" ADD CONSTRAINT "payroll_line_components_payroll_line_id_fkey" FOREIGN KEY ("payroll_line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line_components" ADD CONSTRAINT "payroll_line_components_payroll_component_id_fkey" FOREIGN KEY ("payroll_component_id") REFERENCES "payroll_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

