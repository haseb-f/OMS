"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UsersRound } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FinancialReport, type NormalSide } from "@/components/accounting/financial-report";
import { useOpenFullRecord } from "@/components/shared/record-preview";
import {
  accountingReportsService,
  type PartnerStatementResult,
} from "@/services/accounting-reports-service";
import { PartnerPicker } from "@/components/business/partner-picker";
import {
  partnersService,
  type PartnerRoleValue,
  type PartnerPickerRow,
} from "@/services/partners-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import {
  LEDGER_COLUMNS,
  buildLedgerBlock,
  indexLedgerMovements,
  ledgerSummaryItems,
  ledgerTextColumns,
} from "./ledger-lines";
import { useReportQuery } from "./use-report-query";

/** The URL key that keeps the selected partner across reloads and shared links. */
const PARTNER_PARAM = "partner";

/**
 * Customer / Supplier Statement — the partner's Receivable (customer) or
 * Payable (supplier) control-account lines from Journal Entries: opening
 * balance, invoices, receipts/payments, returns/credits with a running
 * balance, and the closing balance (debit-positive, like the General
 * Ledger). Always the full statement for the period — never a page of it.
 */
export function PartnerStatementTab({ role }: { role: PartnerRoleValue }) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openFullRecord = useOpenFullRecord();
  const { filters, setFilters, params } = useReportQuery();
  const [partner, setPartner] = useState<PartnerPickerRow | null>(null);
  const [statement, setStatement] = useState<PartnerStatementResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const controlType = role === "SUPPLIER" ? "PAYABLE" : "RECEIVABLE";
  // Customer balances are normally debit (we are owed), supplier balances
  // normally credit (we owe): the opposite is adverse (red).
  const normalSide: NormalSide = role === "SUPPLIER" ? "credit" : "debit";
  const statementTitle =
    role === "CUSTOMER"
      ? t("reports.finance.customerStatement")
      : t("reports.finance.supplierStatement");
  const partnerIdFromUrl = searchParams.get(PARTNER_PARAM);

  // Restore the partner chosen before a reload / from a shared link.
  useEffect(() => {
    if (!partnerIdFromUrl || partner?.id === partnerIdFromUrl) return;
    let cancelled = false;
    partnersService
      .catalog({ ids: [partnerIdFromUrl], pageSize: 1, role: [role] })
      .then((result) => {
        if (!cancelled && result.items[0]) setPartner(result.items[0]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [partnerIdFromUrl, partner?.id, role]);

  const selectPartner = (next: PartnerPickerRow) => {
    setPartner(next);
    const query = new URLSearchParams(searchParams.toString());
    query.set(PARTNER_PARAM, next.id);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const load = useCallback(async () => {
    if (!partner) {
      setStatement(null);
      return;
    }
    setIsLoading(true);
    try {
      setStatement(
        await accountingReportsService.partnerStatement(partner.id, { ...params, controlType }),
      );
    } catch (error) {
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [partner, params, controlType]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const blocks = useMemo(
    () =>
      statement
        ? [
            {
              id: `partner:${statement.partner.id}`,
              code: statement.partner.partnerNumber,
              label: statement.partner.name,
              openingBalance: statement.openingBalance,
              periodDebit: statement.periodDebit,
              periodCredit: statement.periodCredit,
              closingBalance: statement.closingBalance,
              movements: statement.movements,
              normalSide,
            },
          ]
        : [],
    [statement, normalSide],
  );
  const lines = useMemo(
    () => blocks.map((block) => buildLedgerBlock(block, t, { showAccount: true })),
    [blocks, t],
  );
  const movementIndex = useMemo(() => indexLedgerMovements(blocks), [blocks]);
  const textColumns = useMemo(
    () => ledgerTextColumns(movementIndex, { showPartner: false }),
    [movementIndex],
  );

  return (
    <FinancialReport
      lines={partner ? lines : []}
      columns={LEDGER_COLUMNS}
      textColumns={textColumns}
      nameHeaderKey="reports.finance.fields.description"
      defaultExpanded="all"
      exportAllLines
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      printTitle={statement ? `${statementTitle} — ${statement.partner.name}` : statementTitle}
      exportFileName={`${role.toLowerCase()}-statement.xlsx`}
      signConvention
      toolbarExtra={<PartnerPicker role={role} value={partner} onChange={selectPartner} />}
      placeholder={
        !partner ? (
          <EmptyState
            icon={UsersRound}
            title={statementTitle}
            description={t("reports.finance.partnerStatement.selectDescription")}
          />
        ) : undefined
      }
      summary={statement ? { items: ledgerSummaryItems(t, statement, normalSide) } : undefined}
      onPostingClick={(line) => {
        const movement = movementIndex.get(line.id);
        if (movement) {
          openFullRecord({
            kind: "JOURNAL_ENTRY",
            id: movement.journalEntryId,
            number: movement.entryNumber,
          });
        }
      }}
    />
  );
}
