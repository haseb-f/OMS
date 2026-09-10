"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Archive, FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  DetailWorkspace,
  DetailSection,
  DetailFieldRow,
} from "@/components/shared/detail-workspace";
import { ModalSection } from "@/components/shared/modal-section";
import { EntityTabs } from "@/components/business/entity-tabs";
import { RowActionsMenu } from "@/components/shared/data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CommissionPlanTiersEditor,
  EMPTY_TIER_DRAFT,
  type CommissionPlanTierDraft,
} from "@/components/hr/commission-plan-tiers-editor";
import {
  commissionPlansService,
  type CommissionPlanDetail,
  type CommissionBasis,
  type CommissionRuleType,
  type CommissionAssignmentScope,
} from "@/services/commission-plans-service";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import { salesTeamsService, type SalesTeamRow } from "@/services/sales-teams-service";
import { useDepartments } from "@/hooks/use-reference-data";
import type { DepartmentRow } from "@/config/master-data/entities";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

const BASIS_VALUES: CommissionBasis[] = ["COLLECTED_SALES", "SALES_REVENUE", "ORDERS_COUNT"];
const RULE_TYPES: CommissionRuleType[] = ["FLAT_PERCENTAGE", "ACHIEVEMENT_TIER", "FIXED_BONUS"];
const ASSIGNMENT_SCOPES: CommissionAssignmentScope[] = [
  "EMPLOYEE",
  "TEAM",
  "DEPARTMENT",
  "COMPANY",
];

function assignmentTargetLabel(
  assignment: CommissionPlanDetail["assignments"][number],
  t: (key: MessageKey) => string,
) {
  if (assignment.scope === "EMPLOYEE") {
    return assignment.employeeProfile
      ? assignment.employeeProfile.partner.name
      : t("hr.commissionPlans.assignmentScope.EMPLOYEE");
  }
  if (assignment.scope === "TEAM") return assignment.salesTeam?.name ?? "—";
  if (assignment.scope === "DEPARTMENT") return assignment.department?.name ?? "—";
  return t("hr.commissionPlans.assignmentScope.COMPANY");
}

export default function CommissionPlanEditorPage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const departments = useDepartments();

  const canEdit = hasPermission("hr.commission-plans.edit");
  const canArchive = hasPermission("hr.commission-plans.archive");

  const [plan, setPlan] = useState<CommissionPlanDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState<CommissionBasis>("COLLECTED_SALES");
  const [ruleType, setRuleType] = useState<CommissionRuleType>("FLAT_PERCENTAGE");
  const [tiers, setTiers] = useState<CommissionPlanTierDraft[]>([{ ...EMPTY_TIER_DRAFT }]);
  const [isSaving, setIsSaving] = useState(false);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const [assignScope, setAssignScope] = useState<CommissionAssignmentScope>("EMPLOYEE");
  const [assignEmployee, setAssignEmployee] = useState<EmployeeRow | null>(null);
  const [assignTeam, setAssignTeam] = useState<SalesTeamRow | null>(null);
  const [assignDepartment, setAssignDepartment] = useState<DepartmentRow | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await commissionPlansService.get(params.id);
      setPlan(result);
      setName(result.name);
      setDescription(result.description ?? "");
      setBasis(result.basis);
      setRuleType(result.ruleType);
      setTiers(
        result.tiers.length > 0
          ? result.tiers.map((tier) => ({
              minAchievementPercent: Number(tier.minAchievementPercent),
              maxAchievementPercent: tier.maxAchievementPercent
                ? Number(tier.maxAchievementPercent)
                : undefined,
              percentage: tier.percentage ? Number(tier.percentage) : undefined,
              fixedAmount: tier.fixedAmount ? Number(tier.fixedAmount) : undefined,
            }))
          : [{ ...EMPTY_TIER_DRAFT }],
      );
    } catch {
      setPlan(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useBreadcrumbLabel(plan?.name ?? null);

  const changeRuleType = (value: CommissionRuleType) => {
    setRuleType(value);
    if (value === "FLAT_PERCENTAGE") {
      setTiers((current) => [
        { ...current[0], minAchievementPercent: 0, maxAchievementPercent: undefined },
      ]);
    } else if (tiers.length === 0) {
      setTiers([{ ...EMPTY_TIER_DRAFT }]);
    }
  };

  const saveDetails = async () => {
    if (!plan || !name.trim()) {
      toast.error(t("common.failedToSave"));
      return;
    }
    for (const tier of tiers) {
      if (tier.minAchievementPercent === undefined) {
        toast.error(t("common.failedToSave"));
        return;
      }
      if (ruleType === "FIXED_BONUS" && tier.fixedAmount === undefined) {
        toast.error(t("common.failedToSave"));
        return;
      }
      if (ruleType !== "FIXED_BONUS" && tier.percentage === undefined) {
        toast.error(t("common.failedToSave"));
        return;
      }
    }
    setIsSaving(true);
    try {
      await commissionPlansService.update(plan.id, {
        name,
        description: description || undefined,
        basis,
        ruleType,
        tiers: tiers.map((tier, index) => ({
          minAchievementPercent: tier.minAchievementPercent ?? 0,
          maxAchievementPercent: tier.maxAchievementPercent,
          percentage: ruleType === "FIXED_BONUS" ? undefined : tier.percentage,
          fixedAmount: ruleType === "FIXED_BONUS" ? tier.fixedAmount : undefined,
          sortOrder: index,
        })),
      });
      toast.success(t("hr.commissionPlans.toasts.saved"));
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!plan) return;
    setIsMutating(true);
    try {
      await commissionPlansService.archive(plan.id);
      toast.success(t("common.archive"));
      setArchiveOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  const confirmRestore = async () => {
    if (!plan) return;
    setIsMutating(true);
    try {
      await commissionPlansService.restore(plan.id);
      toast.success(t("common.restore"));
      setRestoreOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  const submitAssignment = async () => {
    if (!plan) return;
    if (assignScope === "EMPLOYEE" && !assignEmployee) {
      toast.error(t("common.failedToSave"));
      return;
    }
    if (assignScope === "TEAM" && !assignTeam) {
      toast.error(t("common.failedToSave"));
      return;
    }
    if (assignScope === "DEPARTMENT" && !assignDepartment) {
      toast.error(t("common.failedToSave"));
      return;
    }
    setIsAssigning(true);
    try {
      await commissionPlansService.assign(plan.id, {
        scope: assignScope,
        employeeProfileId:
          assignScope === "EMPLOYEE" ? (assignEmployee?.id ?? undefined) : undefined,
        salesTeamId: assignScope === "TEAM" ? (assignTeam?.id ?? undefined) : undefined,
        departmentId:
          assignScope === "DEPARTMENT" ? (assignDepartment?.id ?? undefined) : undefined,
      });
      toast.success(t("hr.commissionPlans.toasts.assigned"));
      setAssignEmployee(null);
      setAssignTeam(null);
      setAssignDepartment(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsAssigning(false);
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    setIsAssigning(true);
    try {
      await commissionPlansService.unassign(assignmentId);
      toast.success(t("hr.commissionPlans.toasts.unassigned"));
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsAssigning(false);
    }
  };

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!plan) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  return (
    <DetailWorkspace
      title={plan.name}
      subtitle={t(`hr.commissionPlans.ruleType.${plan.ruleType}` as MessageKey)}
      status={
        <StatusBadge
          label={plan.deletedAt ? t("common.archived") : t("common.active")}
          tone={plan.deletedAt ? "neutral" : "success"}
        />
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !canArchive || !!plan.deletedAt,
              destructive: true,
              onSelect: () => setArchiveOpen(true),
            },
            {
              key: "restore",
              label: t("common.restore"),
              icon: RotateCcw,
              hidden: !canArchive || !plan.deletedAt,
              onSelect: () => setRestoreOpen(true),
            },
          ]}
        />
      }
    >
      <EntityTabs
        tabs={[
          {
            value: "details",
            label: t("common.generalInformation"),
            content: (
              <div className="flex flex-col gap-3">
                <ModalSection title={t("common.generalInformation")} columns={2}>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-caption font-medium">
                      {t("hr.commissionPlans.fields.name")}
                    </label>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-caption font-medium">
                      {t("hr.commissionPlans.fields.description")}
                    </label>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption font-medium">
                      {t("hr.commissionPlans.fields.basis")}
                    </label>
                    <Select
                      value={basis}
                      onValueChange={(value) => setBasis(value as CommissionBasis)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BASIS_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`hr.commissionPlans.basis.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption font-medium">
                      {t("hr.commissionPlans.fields.ruleType")}
                    </label>
                    <Select
                      value={ruleType}
                      onValueChange={(value) => changeRuleType(value as CommissionRuleType)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RULE_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`hr.commissionPlans.ruleType.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </ModalSection>

                <DetailSection title={t("hr.commissionPlans.tiers.title")}>
                  <CommissionPlanTiersEditor
                    ruleType={ruleType}
                    tiers={tiers}
                    onChange={setTiers}
                  />
                </DetailSection>

                {canEdit && (
                  <EnterpriseButton
                    type="button"
                    className="self-start"
                    onClick={() => void saveDetails()}
                    disabled={isSaving}
                  >
                    {t("common.save")}
                  </EnterpriseButton>
                )}
              </div>
            ),
          },
          {
            value: "assignments",
            label: t("hr.commissionPlans.assignment.title"),
            content: (
              <div className="flex flex-col gap-3">
                <p className="text-caption text-muted-foreground">
                  {t("hr.commissionPlans.assignment.priority")}
                </p>

                <DetailSection>
                  {plan.assignments.length === 0 ? (
                    <p className="text-caption text-muted-foreground">{t("common.noResults")}</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {plan.assignments.map((assignment) => (
                        <DetailFieldRow
                          key={assignment.id}
                          label={t(
                            `hr.commissionPlans.assignmentScope.${assignment.scope}` as MessageKey,
                          )}
                          value={
                            <div className="flex items-center gap-2">
                              <span>{assignmentTargetLabel(assignment, t)}</span>
                              {canEdit && (
                                <EnterpriseButton
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t("common.remove")}
                                  disabled={isAssigning}
                                  onClick={() => void removeAssignment(assignment.id)}
                                >
                                  <Trash2 className="size-3.5" />
                                </EnterpriseButton>
                              )}
                            </div>
                          }
                        />
                      ))}
                    </div>
                  )}
                </DetailSection>

                {canEdit && (
                  <ModalSection
                    title={t("hr.commissionPlans.assignment.addAssignment")}
                    columns={2}
                  >
                    <div className="flex flex-col gap-1.5">
                      <label className="text-caption font-medium">
                        {t("hr.commissionPlans.assignment.scope")}
                      </label>
                      <Select
                        value={assignScope}
                        onValueChange={(value) =>
                          setAssignScope(value as CommissionAssignmentScope)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNMENT_SCOPES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {t(`hr.commissionPlans.assignmentScope.${value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-caption font-medium">
                        {t("hr.commissionPlans.assignment.target")}
                      </label>
                      {assignScope === "EMPLOYEE" && (
                        <EntityCombobox
                          value={assignEmployee}
                          onChange={setAssignEmployee}
                          onSearch={employeesService.search}
                          getId={(employee) => employee.id}
                          getTitle={(employee) => employee.name}
                          getSearchText={(employee) => employee.employeeCode}
                          getSubtitle={(employee) => employee.employeeCode}
                          subtitleDir="ltr"
                          placeholder={t("common.select")}
                          allowClear
                        />
                      )}
                      {assignScope === "TEAM" && (
                        <EntityCombobox
                          value={assignTeam}
                          onChange={setAssignTeam}
                          onSearch={(search) => salesTeamsService.list(search || undefined)}
                          getId={(team) => team.id}
                          getTitle={(team) => team.name}
                          getSearchText={(team) => team.code}
                          getSubtitle={(team) => team.code}
                          subtitleDir="ltr"
                          placeholder={t("common.select")}
                          allowClear
                        />
                      )}
                      {assignScope === "DEPARTMENT" && (
                        <EntityCombobox
                          value={assignDepartment}
                          onChange={setAssignDepartment}
                          items={departments}
                          getId={(department) => department.id}
                          getTitle={(department) => department.name}
                          getSearchText={(department) => department.code}
                          getSubtitle={(department) => department.code}
                          subtitleDir="ltr"
                          placeholder={t("common.select")}
                          allowClear
                        />
                      )}
                      {assignScope === "COMPANY" && (
                        <p className="pt-2 text-caption text-muted-foreground">
                          {t("hr.commissionPlans.assignmentScope.COMPANY")}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <EnterpriseButton
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void submitAssignment()}
                        disabled={isAssigning}
                      >
                        <Plus />
                        {t("hr.commissionPlans.assignment.addAssignment")}
                      </EnterpriseButton>
                    </div>
                  </ModalSection>
                )}
              </div>
            ),
          },
        ]}
      />

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmArchive()}
      />
      <ConfirmationDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={t("common.confirmRestoreTitle")}
        description={t("common.confirmRestoreDescription")}
        confirmLabel={t("common.restore")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmRestore()}
      />
    </DetailWorkspace>
  );
}
