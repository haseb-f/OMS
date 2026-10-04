"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { RecordGridCard } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import { CommissionDetailButton, commissionStatusTone } from "@/config/hr/commissions";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { CommissionCalculationRow } from "@/services/commissions-service";

/**
 * The commission calculation card of the Grid view (R9): the employee, the
 * period, the commission amount as the key figure, the basis/target/achievement
 * and the calculation status - the fields the Commissions table shows. The
 * row has no detail route; the breakdown opens through the same control the
 * table uses. Colour = calculation status.
 */
export function CommissionGridCard({
  commission,
  selected,
  onToggleSelected,
  onOpenDetail,
}: {
  commission: CommissionCalculationRow;
  selected: boolean;
  onToggleSelected: () => void;
  onOpenDetail: (row: CommissionCalculationRow) => void;
}) {
  const { t } = useLocale();
  const name = commission.employeeProfile.partner.name;
  const status = commission.status;
  return (
    <RecordGridCard
      tone={commissionStatusTone[status]}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name })}
      title={<LocaleText>{name}</LocaleText>}
      subtitle={
        commission.commissionPlan?.name ? (
          <LocaleText>{commission.commissionPlan.name}</LocaleText>
        ) : null
      }
      reference={
        <SemanticValue kind="id" className="font-medium">
          {commission.employeeProfile.employeeCode}
        </SemanticValue>
      }
      meta={
        <span className="inline-flex items-baseline gap-2">
          <SemanticValue kind="date">{commission.period}</SemanticValue>
          <SemanticValue kind="money" className="font-semibold text-foreground">
            {formatMoney(commission.amount)}
          </SemanticValue>
        </span>
      }
      fields={[
        {
          key: "basisAmount",
          label: t("hr.commissions.fields.basisAmount"),
          value: <SemanticValue kind="money">{formatMoney(commission.basisAmount)}</SemanticValue>,
          numeric: true,
        },
        ...(commission.targetAmount
          ? [
              {
                key: "targetAmount",
                label: t("hr.commissions.fields.targetAmount"),
                value: (
                  <SemanticValue kind="money">{formatMoney(commission.targetAmount)}</SemanticValue>
                ),
                numeric: true,
              },
            ]
          : []),
        ...(commission.achievementPercent
          ? [
              {
                key: "achievementPercent",
                label: t("hr.commissions.fields.achievementPercent"),
                value: (
                  <SemanticValue kind="number">
                    {`${Number(commission.achievementPercent).toFixed(1)}%`}
                  </SemanticValue>
                ),
                numeric: true,
              },
            ]
          : []),
      ]}
      badges={
        <StatusBadge
          label={t(`hr.commissions.status.${status}` as MessageKey)}
          tone={commissionStatusTone[status]}
        />
      }
      actionsNode={
        <CommissionDetailButton
          row={commission}
          label={t("common.view")}
          onOpenDetail={onOpenDetail}
        />
      }
    />
  );
}
