"use client";

import { useCallback } from "react";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePrintCompany } from "@/components/print/print-brand";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, formatDateRange } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { PeriodStatement } from "@/services/company-partners-service";
import { buildPartnerStatementPrintPayload, type StatementPrintPayment } from "./statement-print";
import { statementPeriodName, statementPeriodTerms } from "./statement-columns";

/**
 * R15 (spec-w4 §6) — prints a partner's per-period statement through the
 * shared Print Engine (portrait, company header, print date, page numbers).
 * The staff page and the partner portal call the same builder with the same
 * labels, so the two printouts can never differ.
 */
export function usePartnerStatementPrint() {
  const { t, locale, direction } = useLocale();
  const { user } = useUserContext();
  const company = usePrintCompany();
  const { printList } = usePrintEngine();

  return useCallback(
    (
      statement: PeriodStatement,
      partner: { name: string; partnerNumber: string },
      payments: StatementPrintPayment[],
    ) => {
      const { partnership } = statement;
      const context = { t, locale };
      printList(
        buildPartnerStatementPrintPayload(statement, payments, {
          title: t("companyPartners.statement.printTitle"),
          company,
          printedByName: user?.fullName ?? null,
          direction,
          meta: [
            {
              label: t("companyPartners.statement.printPartner"),
              value: `${partner.name} · ${partner.partnerNumber}`,
            },
            {
              label: t("companyPartners.statement.printRange"),
              value: formatDateRange(statement.range.from, statement.range.to),
              ltr: true,
            },
            {
              label: t("companyPartners.statement.printCurrency"),
              value: statement.currency?.code ?? "—",
            },
            {
              label: t("companyPartners.statement.printPartnership"),
              value:
                partnership.status === "ENDED" && partnership.endsOn
                  ? `${t("companyPartners.partnership.ENDED")} · ${formatDate(partnership.endsOn)}`
                  : t(`companyPartners.partnership.${partnership.status}`),
            },
            {
              label: t("companyPartners.statement.printPayable"),
              value: formatMoney(statement.position.payable, statement.currency?.code),
              ltr: true,
            },
          ],
          notes: [t("companyPartners.statement.note")],
          labels: {
            period: t("companyPartners.statement.fields.period"),
            status: t("companyPartners.statement.fields.status"),
            terms: t("companyPartners.statement.fields.terms"),
            entitlement: t("companyPartners.statement.fields.entitlement"),
            approvedDue: t("companyPartners.statement.fields.approvedDue"),
            paid: t("companyPartners.statement.fields.paid"),
            remaining: t("companyPartners.statement.fields.remaining"),
            periods: t("companyPartners.statement.periodsTab"),
            totalApproved: t("companyPartners.statement.totalApproved"),
            totalEstimated: t("companyPartners.statement.totalEstimated"),
            payments: t("companyPartners.statement.paymentsTab"),
            adjustments: t("companyPartners.statement.adjustmentsTab"),
            none: t("companyPartners.statement.none"),
          },
          periodName: (row) => statementPeriodName(row, context),
          statusLabel: (status) => t(`companyPartners.statement.status.${status}`),
          terms: (row) => statementPeriodTerms(row, context),
        }),
      );
    },
    [t, locale, direction, company, user?.fullName, printList],
  );
}
