"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { PeriodStatementView } from "@/config/company-partners/period-statement-view";
import { buildPortalPaymentColumns } from "@/config/company-partners/statement-columns";
import { usePartnerStatementPrint } from "@/config/company-partners/use-statement-print";
import { partnerPortalService, type PortalStatement } from "@/services/partner-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import { apiErrorMessage } from "@/lib/toast";

/**
 * Partner portal statement (R15 D15-14 / D15-15, spec-w4 §5-6): the partner's
 * own per-period statement — the same computation and the same view staff
 * see on the partner page, without anything internal (accounts, journal
 * entries, other partners). Read-only; the range defaults on the server to
 * the year to date, or to the year the partnership ended.
 */
function PartnerStatementContent() {
  const { t, locale } = useLocale();
  const printStatement = usePartnerStatementPrint();
  const [picked, setPicked] = useState<DateRangeValue | null>(null);
  const [statement, setStatement] = useState<PortalStatement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      from: picked?.from ? toISODate(picked.from) : undefined,
      to: picked?.to ? toISODate(picked.to) : undefined,
    }),
    [picked],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStatement(await partnerPortalService.statement(query));
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const range: DateRangeValue = picked ?? {
    from: fromISODate(statement?.range.from),
    to: fromISODate(statement?.range.to),
  };
  const paymentColumns = useMemo(() => buildPortalPaymentColumns({ t, locale }), [t, locale]);

  const print = () => {
    if (!statement) return;
    printStatement(
      statement,
      statement.partner,
      statement.payments.map((payment) => {
        const method = t(`companyPartners.statement.method.${payment.method}`);
        return {
          date: payment.date,
          reference: [payment.paymentNumber, payment.reference].filter(Boolean).join(" · "),
          description: payment.reversed
            ? `${method} — ${t("companyPartners.statement.reversed")}`
            : method,
          amount: payment.amount,
        };
      }),
    );
  };

  return (
    <PageWorkspace
      title={t("partnerPortal.statement.title")}
      description={t("partnerPortal.statement.description")}
      actions={
        <HeaderActions
          secondary={[
            {
              key: "print",
              label: t("companyPartners.statement.print"),
              icon: Printer,
              disabled: !statement,
              onSelect: print,
            },
          ]}
          inline={<EnterpriseDateRangePicker value={range} onChange={setPicked} />}
        />
      }
    >
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <PeriodStatementView
        statement={statement}
        isLoading={isLoading}
        tableIdPrefix="partner-portal"
        payments={
          <EnterpriseDataTable
            tableId="partner-portal-statement-payments"
            columns={paymentColumns}
            data={statement?.payments ?? []}
            isLoading={isLoading}
            getRowId={(row) => row.paymentNumber}
            emptyTitle={t("companyPartners.statement.noPayments")}
          />
        }
      />
    </PageWorkspace>
  );
}

export default function PartnerStatementPage() {
  return (
    <PermissionGate permission="partner.statement.view">
      <PartnerStatementContent />
    </PermissionGate>
  );
}
