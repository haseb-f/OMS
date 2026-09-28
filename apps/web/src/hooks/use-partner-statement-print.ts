"use client";

import { useCallback, useState } from "react";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { accountingReportsService } from "@/services/accounting-reports-service";
import type { PartnerRow } from "@/services/partners-service";
import { loadFunctionalCurrency } from "@/components/accounting/financial-report";
import { formatDate } from "@/lib/date";
import { reportApiError, toast } from "@/lib/toast";
import type { StatementPrintPayload } from "@/types/print-engine";

/**
 * "Print statement" on the customer / supplier detail pages (Print Design
 * System spec §3): fetches the complete partner statement
 * (`GET /accounting/reports/partner-statement`, full and unpaged, the
 * Receivable or Payable control lines) and prints it through the account
 * statement template. Read-only; the same data the Customer / Supplier
 * statement report shows, stated in the functional currency.
 */
export function usePartnerStatementPrint(role: "customer" | "supplier") {
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user } = useUserContext();
  const [isPreparing, setIsPreparing] = useState(false);

  const printStatement = useCallback(
    async (partner: PartnerRow) => {
      setIsPreparing(true);
      const loadingToast = toast.loading(t("common.loading"));
      try {
        const [statement, currency] = await Promise.all([
          accountingReportsService.partnerStatement(partner.id, {
            controlType: role === "supplier" ? "PAYABLE" : "RECEIVABLE",
          }),
          loadFunctionalCurrency(),
        ]);
        const payload: StatementPrintPayload = {
          variant: "account-statement",
          title: t(
            role === "supplier"
              ? "printDocument.statementTitleSupplier"
              : "printDocument.statementTitleCustomer",
          ),
          printedByName: user?.fullName ?? null,
          company: { name: activeCompany?.name ?? "", logoUrl: activeCompany?.logoUrl ?? null },
          partyRole: role,
          party: {
            name: partner.name,
            number: partner.partnerNumber,
            lines: [partner.address, partner.city, partner.country?.name].filter(
              (value): value is string => !!value,
            ),
            phone: partner.phone || partner.mobile || undefined,
            taxNumber: partner.taxNumber ?? undefined,
          },
          // The detail-page statement is unbounded — the partner's full history.
          period: t("printDocument.allDates"),
          currency,
          openingBalance: statement.openingBalance,
          movements: statement.movements.map((movement) => ({
            date: formatDate(movement.entryDate),
            reference: movement.referenceNumber || movement.entryNumber,
            description: movement.description || movement.journal?.name || movement.entryNumber,
            debit: movement.debit,
            credit: movement.credit,
            balance: movement.runningBalance,
          })),
          periodDebit: statement.periodDebit,
          periodCredit: statement.periodCredit,
          closingBalance: statement.closingBalance,
          recordPath: `/${role === "supplier" ? "purchasing/suppliers" : "sales/customers"}/${partner.id}`,
        };
        printDocument(payload);
      } catch (error) {
        reportApiError(error, "errors.loadFailed");
      } finally {
        toast.dismiss(loadingToast);
        setIsPreparing(false);
      }
    },
    [activeCompany, printDocument, role, t, user],
  );

  return { printStatement, isPreparing };
}
