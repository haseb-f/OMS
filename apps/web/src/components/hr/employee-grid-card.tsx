"use client";

import type { ReactNode } from "react";
import { StatusBadge } from "@/components/business/status-badge";
import { RecordGridCard } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import { employeeStatusTone } from "@/config/hr/employees";
import { ActiveArchivedBadge } from "@/config/master-data/shared-columns";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { EmployeeRow } from "@/services/employees-service";

/**
 * The employee card of the Grid view (R9): name, job title and department,
 * employee number, hire date, mobile and employment status - exactly the
 * fields the Employees table shows. Compensation, salary and account data
 * never appear here (they live on the profile's own permission-gated tabs).
 * Colour = employment status; an archived employee also gets the shared
 * Archived badge.
 */
export function EmployeeGridCard({
  employee,
  selected,
  onToggleSelected,
  actionsNode,
}: {
  employee: EmployeeRow;
  selected: boolean;
  onToggleSelected: () => void;
  /** The page's own row-actions menu (MasterDataPage) - same permissions as the table. */
  actionsNode: ReactNode;
}) {
  const { t } = useLocale();
  const work = [employee.jobTitle?.name, employee.department?.name].filter(Boolean).join(" · ");
  return (
    <RecordGridCard
      tone={employee.deletedAt ? "neutral" : employeeStatusTone[employee.employmentStatus]}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: employee.name })}
      title={<LocaleText>{employee.name}</LocaleText>}
      href={`/hr/employees/${employee.id}`}
      subtitle={work ? <LocaleText>{work}</LocaleText> : null}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {employee.employeeCode}
        </SemanticValue>
      }
      meta={
        employee.hireDate ? (
          <SemanticValue kind="date">{formatDate(employee.hireDate)}</SemanticValue>
        ) : null
      }
      fields={
        employee.mobile
          ? [
              {
                key: "mobile",
                label: t("hr.employees.fields.mobile"),
                value: <SemanticValue kind="phone">{employee.mobile}</SemanticValue>,
              },
            ]
          : []
      }
      badges={
        <>
          <StatusBadge
            label={t(`hr.employees.status.${employee.employmentStatus}` as MessageKey)}
            tone={employeeStatusTone[employee.employmentStatus]}
          />
          {employee.deletedAt ? <ActiveArchivedBadge deletedAt={employee.deletedAt} /> : null}
        </>
      }
      actionsNode={actionsNode}
    />
  );
}
