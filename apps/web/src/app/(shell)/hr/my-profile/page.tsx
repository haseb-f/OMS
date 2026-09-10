"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { SemanticValue } from "@/components/shared/semantic-value";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import { salesTargetsService, type MyRankingResult } from "@/services/sales-targets-service";
import { formatTargetAmount } from "@/config/hr/sales-targets";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

function achievementTone(percent: number | null): StatusTone {
  if (percent === null) return "neutral";
  if (percent >= 100) return "success";
  if (percent >= 75) return "info";
  if (percent >= 50) return "warning";
  return "destructive";
}

/** Part S "ترتيبك #3" — every authenticated employee's own read-only HR record + sales ranking, both unguarded self-view endpoints. Never shows compensation (permission-gated, not part of `/employees/me`). */
export default function MyProfilePage() {
  const { t } = useLocale();
  const [employee, setEmployee] = useState<EmployeeRow | null | undefined>(undefined);
  const [ranking, setRanking] = useState<MyRankingResult | null>(null);

  useEffect(() => {
    employeesService
      .me()
      .then(setEmployee)
      .catch(() => setEmployee(null));
  }, []);

  useEffect(() => {
    salesTargetsService
      .myRanking()
      .then(setRanking)
      .catch(() => setRanking(null));
  }, []);

  if (employee === undefined) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!employee) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  return (
    <DetailWorkspace
      title={employee.name}
      subtitle={employee.employeeCode}
      status={
        <StatusBadge
          label={t(`hr.employees.status.${employee.employmentStatus}` as MessageKey)}
          tone={
            employee.employmentStatus === "ACTIVE"
              ? "success"
              : employee.employmentStatus === "TERMINATED"
                ? "destructive"
                : "neutral"
          }
        />
      }
    >
      <DetailSection title={t("hr.employees.profile.tabs.general")}>
        <DetailFieldGrid>
          <DetailField label={t("hr.employees.fields.mobile")} value={employee.mobile} />
          <DetailField label={t("hr.employees.fields.email")} value={employee.email} />
          <DetailField
            label={t("hr.employees.fields.hireDate")}
            value={
              employee.hireDate ? (
                <SemanticValue kind="date">{formatDate(employee.hireDate)}</SemanticValue>
              ) : undefined
            }
          />
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={t("hr.employees.profile.tabs.work")}>
        <DetailFieldGrid>
          <DetailField
            label={t("hr.employees.fields.department")}
            value={employee.department?.name}
          />
          <DetailField label={t("hr.employees.fields.jobTitle")} value={employee.jobTitle?.name} />
          <DetailField
            label={t("hr.employees.fields.salesTeam")}
            value={employee.salesTeam?.name}
          />
          <DetailField
            label={t("hr.employees.fields.manager")}
            value={
              employee.manager
                ? `${employee.manager.employeeCode} — ${employee.manager.name}`
                : undefined
            }
          />
        </DetailFieldGrid>
      </DetailSection>

      {ranking && (
        <DetailSection title={t("hr.ranking.title")}>
          <DetailFieldGrid>
            <DetailField
              label={t("hr.salesTargets.fields.targetAmount")}
              value={formatTargetAmount(ranking.targetAmount)}
            />
            <DetailField
              label={t("hr.salesTargets.fields.actualAmount")}
              value={formatTargetAmount(ranking.actual)}
            />
            <DetailField
              label={t("hr.salesTargets.fields.achievement")}
              value={
                ranking.achievementPercent === null ? undefined : (
                  <StatusBadge
                    label={`${ranking.achievementPercent.toFixed(1)}%`}
                    tone={achievementTone(ranking.achievementPercent)}
                  />
                )
              }
            />
            <DetailField
              label={t("hr.ranking.rank")}
              value={
                ranking.rank
                  ? `#${ranking.rank} ${t("hr.ranking.of", { total: ranking.of })}`
                  : undefined
              }
            />
          </DetailFieldGrid>
        </DetailSection>
      )}
    </DetailWorkspace>
  );
}
