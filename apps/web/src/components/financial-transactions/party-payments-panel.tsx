"use client";

import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { DetailField, DetailFieldGrid, DetailSection } from "@/components/shared/detail-workspace";
import { OpenInvoicesTable } from "@/components/financial-transactions/open-invoices-table";
import {
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type {
  FinancialTransactionRow,
  OpenInvoiceRow,
} from "@/services/financial-transactions-service";

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Customer Profile "Payments" tab and Supplier Profile "Payments" tab
 * (TASK-044 Parts 4-5) — genuinely shared between both domains (party-
 * agnostic `FinancialTransactionRow`/`OpenInvoiceRow` inputs, same shape as
 * `FinancialTransactionEditor`'s render-prop sharing), read-only.
 */
export function PartyPaymentsPanel({
  transactions,
  isLoadingTransactions,
  openInvoices,
  isLoadingOpenInvoices,
  historyTitle,
  outstandingLabel,
  paidLabel,
  documentHref,
  onCreateNew,
  createLabel,
}: {
  transactions: FinancialTransactionRow[];
  isLoadingTransactions: boolean;
  openInvoices: OpenInvoiceRow[];
  isLoadingOpenInvoices: boolean;
  historyTitle: string;
  outstandingLabel: string;
  paidLabel: string;
  documentHref: (id: string) => string;
  /** "New Receipt" / "New Payment" quick action (TASK-045) — omitted entirely when the caller has no create permission. */
  onCreateNew?: () => void;
  createLabel?: string;
}) {
  const { t } = useLocale();

  const outstandingBalance = openInvoices.reduce((sum, inv) => sum + inv.remainingBalance, 0);
  const paidAmount = transactions
    .filter((txn) => txn.status === "CONFIRMED")
    .reduce((sum, txn) => sum + Number(txn.amount), 0);

  return (
    <div className="flex flex-col gap-2.5">
      {onCreateNew && createLabel && (
        <div className="flex justify-end">
          <EnterpriseButton type="button" size="sm" className="gap-1.5" onClick={onCreateNew}>
            <Plus className="size-3.5" />
            {createLabel}
          </EnterpriseButton>
        </div>
      )}
      <DetailSection>
        <DetailFieldGrid columns={3}>
          <DetailField label={outstandingLabel} value={formatMoney(outstandingBalance)} />
          <DetailField label={paidLabel} value={formatMoney(paidAmount)} />
          <DetailField
            label={t("financialTransactions.allocationSummary.openInvoices")}
            value={String(openInvoices.length)}
          />
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={historyTitle}>
        {isLoadingTransactions ? (
          <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : transactions.length === 0 ? (
          <EmptyState icon={FileText} title={t("common.noResults")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financialTransactions.allocationGrid.invoice")}</TableHead>
                  <TableHead>{t("financialTransactions.openInvoices.date")}</TableHead>
                  <TableHead className="text-end">
                    {t("financialTransactions.summary.amount")}
                  </TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell>
                      <Link
                        href={documentHref(txn.id)}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:underline"
                        dir="ltr"
                      >
                        {txn.transactionNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(txn.transactionDate)}</TableCell>
                    <TableCell className="text-end" dir="ltr">
                      {formatMoney(Number(txn.amount))}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={t(TRANSACTION_STATUS_LABEL_KEY[txn.status])}
                        tone={TRANSACTION_STATUS_TONE[txn.status]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DetailSection>

      <DetailSection title={t("financialTransactions.allocationSummary.openInvoices")}>
        <OpenInvoicesTable invoices={openInvoices} isLoading={isLoadingOpenInvoices} readOnly />
      </DetailSection>
    </div>
  );
}
