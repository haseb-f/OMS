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
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { SummaryCard } from "@/components/business/summary-card";
import { EmptyState } from "@/components/shared/empty-state";
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
    <div className="flex flex-col gap-4">
      {onCreateNew && createLabel && (
        <div className="flex justify-end">
          <EnterpriseButton type="button" size="sm" className="gap-1.5" onClick={onCreateNew}>
            <Plus className="size-3.5" />
            {createLabel}
          </EnterpriseButton>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title={outstandingLabel}
          rows={[
            { label: outstandingLabel, value: formatMoney(outstandingBalance), emphasis: true },
          ]}
        />
        <SummaryCard
          title={paidLabel}
          rows={[{ label: paidLabel, value: formatMoney(paidAmount), emphasis: true }]}
        />
        <SummaryCard
          title={t("financialTransactions.allocationSummary.openInvoices")}
          rows={[
            {
              label: t("financialTransactions.allocationSummary.openInvoices"),
              value: openInvoices.length,
              emphasis: true,
            },
          ]}
        />
      </div>

      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>{historyTitle}</EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          {isLoadingTransactions ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : transactions.length === 0 ? (
            <EmptyState icon={FileText} title={t("common.noResults")} />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border/70">
              <Table className="w-full table-fixed border-separate border-spacing-0">
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("financialTransactions.allocationGrid.invoice")}</TableHead>
                    <TableHead className="w-32">
                      {t("financialTransactions.openInvoices.date")}
                    </TableHead>
                    <TableHead className="w-32 text-end">
                      {t("financialTransactions.summary.amount")}
                    </TableHead>
                    <TableHead className="w-36">{t("common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell className="align-middle">
                        <Link
                          href={documentHref(txn.id)}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:underline"
                          dir="ltr"
                        >
                          {txn.transactionNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="align-middle">
                        {formatDate(txn.transactionDate)}
                      </TableCell>
                      <TableCell className="align-middle text-end" dir="ltr">
                        {formatMoney(Number(txn.amount))}
                      </TableCell>
                      <TableCell className="align-middle">
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
        </EnterpriseCardContent>
      </EnterpriseCard>

      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("financialTransactions.allocationSummary.openInvoices")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          <OpenInvoicesTable invoices={openInvoices} isLoading={isLoadingOpenInvoices} readOnly />
        </EnterpriseCardContent>
      </EnterpriseCard>
    </div>
  );
}
