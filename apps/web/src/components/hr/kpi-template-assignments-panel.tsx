"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { StatusBadge } from "@/components/business/status-badge";
import {
  kpiTemplatesService,
  type KpiAssignmentScope,
  type KpiTemplateAssignmentRow,
} from "@/services/kpi-templates-service";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import { useDepartments, useJobTitles } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const SCOPES: KpiAssignmentScope[] = ["EMPLOYEE", "JOB_TITLE", "DEPARTMENT"];

function assignmentTargetLabel(assignment: KpiTemplateAssignmentRow): string {
  if (assignment.scope === "EMPLOYEE") return assignment.employeeProfile?.partner.name ?? "—";
  if (assignment.scope === "JOB_TITLE") return assignment.jobTitle?.name ?? "—";
  return assignment.department?.name ?? "—";
}

/**
 * KPI Template's "who gets this template" section (edit mode only — a
 * template needs to exist before it can be assigned). `assign()` replaces
 * any existing assignment for the same scope+target server-side (Part J: at
 * most one active assignment per scope+target across all templates), so
 * adding one here for a target already assigned elsewhere silently takes it
 * over rather than erroring.
 */
export function KpiTemplateAssignmentsPanel({
  templateId,
  assignments,
  onChanged,
}: {
  templateId: string;
  assignments: KpiTemplateAssignmentRow[];
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const departments = useDepartments();
  const jobTitles = useJobTitles();

  const [scope, setScope] = useState<KpiAssignmentScope>("EMPLOYEE");
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [jobTitleId, setJobTitleId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const resetTarget = () => {
    setEmployee(null);
    setJobTitleId("");
    setDepartmentId("");
  };

  const canAdd =
    (scope === "EMPLOYEE" && !!employee) ||
    (scope === "JOB_TITLE" && !!jobTitleId) ||
    (scope === "DEPARTMENT" && !!departmentId);

  const addAssignment = async () => {
    if (!canAdd) return;
    setIsSaving(true);
    try {
      await kpiTemplatesService.assign(templateId, {
        scope,
        employeeProfileId: scope === "EMPLOYEE" ? employee!.id : undefined,
        jobTitleId: scope === "JOB_TITLE" ? jobTitleId : undefined,
        departmentId: scope === "DEPARTMENT" ? departmentId : undefined,
      });
      toast.success(t("hr.kpiTemplates.toasts.assigned"));
      resetTarget();
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    setRemovingId(assignmentId);
    try {
      await kpiTemplatesService.unassign(assignmentId);
      toast.success(t("hr.kpiTemplates.toasts.unassigned"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {assignments.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("common.noResults")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center justify-between gap-2 border-b border-border pb-1.5"
            >
              <div className="flex items-center gap-2">
                <StatusBadge
                  tone="info"
                  label={t(`hr.kpiTemplates.assignmentScope.${assignment.scope}`)}
                />
                <span className="text-body font-medium">{assignmentTargetLabel(assignment)}</span>
              </div>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.delete")}
                disabled={removingId === assignment.id}
                onClick={() => void removeAssignment(assignment.id)}
              >
                <Trash2 className="size-4" />
              </EnterpriseButton>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
        <Select
          value={scope}
          onValueChange={(value) => {
            setScope(value as KpiAssignmentScope);
            resetTarget();
          }}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder={t("hr.kpiTemplates.assignment.scope")} />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`hr.kpiTemplates.assignmentScope.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {scope === "EMPLOYEE" && (
          <EntityCombobox
            value={employee}
            onChange={setEmployee}
            onSearch={employeesService.search}
            getId={(row) => row.id}
            getTitle={(row) => row.name}
            getSubtitle={(row) => row.employeeCode}
            subtitleDir="ltr"
            placeholder={t("hr.kpiTemplates.assignment.target")}
            allowClear
            triggerClassName="sm:w-64"
          />
        )}
        {scope === "JOB_TITLE" && (
          <Select value={jobTitleId} onValueChange={setJobTitleId}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder={t("hr.kpiTemplates.assignment.target")} />
            </SelectTrigger>
            <SelectContent>
              {jobTitles.map((jobTitle) => (
                <SelectItem key={jobTitle.id} value={jobTitle.id}>
                  {jobTitle.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {scope === "DEPARTMENT" && (
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder={t("hr.kpiTemplates.assignment.target")} />
            </SelectTrigger>
            <SelectContent>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <EnterpriseButton
          type="button"
          size="sm"
          disabled={!canAdd || isSaving}
          onClick={() => void addAssignment()}
        >
          <Plus />
          {t("hr.kpiTemplates.assignment.addAssignment")}
        </EnterpriseButton>
      </div>
    </div>
  );
}
