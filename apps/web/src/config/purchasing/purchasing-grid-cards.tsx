"use client";

import type { ReactNode } from "react";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { InvoicePaymentBadge } from "@/components/business/invoice-payment-summary";
import { RecordGridCard } from "@/components/shared/data-table";
import type { RecordGridCardField } from "@/components/shared/data-table/record-grid-card";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { PurchaseOrderRow } from "@/services/purchase-orders-service";
import type { PurchaseInvoiceRow } from "@/services/purchase-invoices-service";
import type { PurchaseQuotationRow } from "@/services/purchase-quotations-service";
import type { PurchaseReturnRow } from "@/services/purchase-returns-service";
import type { FinancialTransactionRow } from "@/services/supplier-payments-service";
import type { LandedCostDocumentRow } from "@/services/landed-cost-service";
import {
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { InvoiceActionsCell, type InvoiceRowHandlers } from "./invoice-columns";
import { INVOICE_STATUS_LABEL_KEY, INVOICE_STATUS_TONE } from "./invoice-status";
import { LANDED_COST_STATUS_LABEL_KEY, LANDED_COST_STATUS_TONE } from "./landed-cost-status";
import { OrderActionsCell, orderGrandTotal, type OrderRowHandlers } from "./order-columns";
import { ORDER_STATUS_LABEL_KEY, ORDER_STATUS_TONE } from "./order-status";
import { QuotationActionsCell, type QuotationRowHandlers } from "./quotation-columns";
import { QUOTATION_STATUS_LABEL_KEY, QUOTATION_STATUS_TONE } from "./quotation-status";
import { ReturnActionsCell, type ReturnRowHandlers } from "./return-columns";
import { RETURN_STATUS_LABEL_KEY, RETURN_STATUS_TONE } from "./return-status";
import { SupplierPaymentActionsCell, type SupplierPaymentRowHandlers } from "./payment-row-actions";

/**
 * Round 9 record-card templates of the Purchasing lists. Every card is the shared
 * `RecordGridCard` mapped the same way: supplier = title, document number =
 * reference, total = key figure, one badge per question (document status, payment).
 * The status/tone maps, money and date components and the row-actions control are
 * the tables' own, so both views show the same state and the same permissions.
 */

interface PurchasingCardChrome {
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
}

interface DocumentCardLabels {
  date: MessageKey;
  reference: MessageKey;
  createdBy: MessageKey;
}

interface DocumentCardModel {
  tone: StatusTone;
  supplierName: string | null;
  supplierPhone: string | null;
  number: string;
  total: string | number;
  createdAt: string;
  referenceNumber: string | null;
  createdByName: string | null;
  badges: ReactNode;
  actionsNode?: ReactNode;
  labels: DocumentCardLabels;
}

function PurchasingDocumentCard({
  tone,
  supplierName,
  supplierPhone,
  number,
  total,
  createdAt,
  referenceNumber,
  createdByName,
  badges,
  actionsNode,
  labels,
  selected,
  onToggleSelected,
  href,
}: DocumentCardModel & PurchasingCardChrome) {
  const { t } = useLocale();
  const title = supplierName ?? "—";
  const fields: RecordGridCardField[] = [
    {
      key: "date",
      label: t(labels.date),
      value: <SemanticValue kind="date">{formatDate(createdAt)}</SemanticValue>,
    },
  ];
  if (referenceNumber) {
    fields.push({
      key: "reference",
      label: t(labels.reference),
      value: <SemanticValue kind="id">{referenceNumber}</SemanticValue>,
    });
  }
  if (createdByName) {
    fields.push({ key: "createdBy", label: t(labels.createdBy), value: createdByName });
  }
  return (
    <RecordGridCard
      tone={tone}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: title })}
      title={<LocaleText>{title}</LocaleText>}
      subtitle={supplierPhone ? <SemanticValue kind="phone">{supplierPhone}</SemanticValue> : null}
      href={href}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {number}
        </SemanticValue>
      }
      meta={<MoneyValue value={total} className="text-foreground" />}
      fields={fields}
      badges={badges}
      actionsNode={actionsNode}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}

export function PurchaseOrderGridCard({
  row,
  handlers,
  ...chrome
}: PurchasingCardChrome & { row: PurchaseOrderRow; handlers: OrderRowHandlers }) {
  const { t } = useLocale();
  return (
    <PurchasingDocumentCard
      {...chrome}
      tone={ORDER_STATUS_TONE[row.status]}
      supplierName={row.partner?.name ?? null}
      supplierPhone={row.partner?.phone ?? null}
      number={row.poNumber}
      total={orderGrandTotal(row)}
      createdAt={row.createdAt}
      referenceNumber={row.referenceNumber}
      createdByName={row.createdBy ? (handlers.usersById[row.createdBy] ?? null) : null}
      badges={
        <StatusBadge
          label={t(ORDER_STATUS_LABEL_KEY[row.status])}
          tone={ORDER_STATUS_TONE[row.status]}
        />
      }
      actionsNode={<OrderActionsCell row={row} handlers={handlers} />}
      labels={{
        date: "purchasing.orders.fields.date",
        reference: "purchasing.orders.fields.reference",
        createdBy: "purchasing.orders.fields.createdBy",
      }}
    />
  );
}

/** Document status and payment status stay two badges, as in the table. */
export function PurchaseInvoiceGridCard({
  row,
  handlers,
  ...chrome
}: PurchasingCardChrome & { row: PurchaseInvoiceRow; handlers: InvoiceRowHandlers }) {
  const { t } = useLocale();
  return (
    <PurchasingDocumentCard
      {...chrome}
      tone={INVOICE_STATUS_TONE[row.status]}
      supplierName={row.partner?.name ?? null}
      supplierPhone={row.partner?.phone ?? null}
      number={row.invoiceNumber}
      total={row.grandTotal}
      createdAt={row.createdAt}
      referenceNumber={row.referenceNumber}
      createdByName={row.createdBy ? (handlers.usersById[row.createdBy] ?? null) : null}
      badges={
        <>
          <StatusBadge
            label={t(INVOICE_STATUS_LABEL_KEY[row.status])}
            tone={INVOICE_STATUS_TONE[row.status]}
          />
          <InvoicePaymentBadge paymentStatus={row.paymentStatus} />
        </>
      }
      actionsNode={<InvoiceActionsCell row={row} handlers={handlers} />}
      labels={{
        date: "purchasing.invoices.fields.date",
        reference: "purchasing.invoices.fields.reference",
        createdBy: "purchasing.invoices.fields.createdBy",
      }}
    />
  );
}

export function PurchaseQuotationGridCard({
  row,
  handlers,
  ...chrome
}: PurchasingCardChrome & { row: PurchaseQuotationRow; handlers: QuotationRowHandlers }) {
  const { t } = useLocale();
  return (
    <PurchasingDocumentCard
      {...chrome}
      tone={QUOTATION_STATUS_TONE[row.status]}
      supplierName={row.partner?.name ?? null}
      supplierPhone={row.partner?.phone ?? null}
      number={row.quotationNumber}
      total={row.grandTotal}
      createdAt={row.createdAt}
      referenceNumber={row.referenceNumber}
      createdByName={row.createdBy ? (handlers.usersById[row.createdBy] ?? null) : null}
      badges={
        <StatusBadge
          label={t(QUOTATION_STATUS_LABEL_KEY[row.status])}
          tone={QUOTATION_STATUS_TONE[row.status]}
        />
      }
      actionsNode={<QuotationActionsCell row={row} handlers={handlers} />}
      labels={{
        date: "purchasing.quotations.fields.date",
        reference: "purchasing.quotations.fields.reference",
        createdBy: "purchasing.quotations.fields.createdBy",
      }}
    />
  );
}

export function PurchaseReturnGridCard({
  row,
  handlers,
  ...chrome
}: PurchasingCardChrome & { row: PurchaseReturnRow; handlers: ReturnRowHandlers }) {
  const { t } = useLocale();
  return (
    <PurchasingDocumentCard
      {...chrome}
      tone={RETURN_STATUS_TONE[row.status]}
      supplierName={row.partner?.name ?? null}
      supplierPhone={row.partner?.phone ?? null}
      number={row.returnNumber}
      total={row.grandTotal}
      createdAt={row.createdAt}
      referenceNumber={row.referenceNumber}
      createdByName={row.createdBy ? (handlers.usersById[row.createdBy] ?? null) : null}
      badges={
        <StatusBadge
          label={t(RETURN_STATUS_LABEL_KEY[row.status])}
          tone={RETURN_STATUS_TONE[row.status]}
        />
      }
      actionsNode={<ReturnActionsCell row={row} handlers={handlers} />}
      labels={{
        date: "purchasing.returns.fields.date",
        reference: "purchasing.returns.fields.reference",
        createdBy: "purchasing.returns.fields.createdBy",
      }}
    />
  );
}

export function SupplierPaymentGridCard({
  row,
  handlers,
  usersById,
  ...chrome
}: PurchasingCardChrome & {
  row: FinancialTransactionRow;
  handlers: SupplierPaymentRowHandlers;
  usersById: Record<string, string>;
}) {
  const { t } = useLocale();
  return (
    <PurchasingDocumentCard
      {...chrome}
      tone={TRANSACTION_STATUS_TONE[row.status]}
      supplierName={row.partner?.name ?? null}
      supplierPhone={null}
      number={row.transactionNumber}
      total={row.amount}
      createdAt={row.createdAt}
      referenceNumber={row.referenceNumber}
      createdByName={row.createdBy ? (usersById[row.createdBy] ?? null) : null}
      badges={
        <StatusBadge
          label={t(TRANSACTION_STATUS_LABEL_KEY[row.status])}
          tone={TRANSACTION_STATUS_TONE[row.status]}
        />
      }
      actionsNode={<SupplierPaymentActionsCell row={row} handlers={handlers} />}
      labels={{
        date: "purchasing.payments.fields.date",
        reference: "purchasing.payments.fields.reference",
        createdBy: "purchasing.payments.fields.createdBy",
      }}
    />
  );
}

/** The Landed Cost list has no selection and no row actions: the card is a plain link. */
export function LandedCostGridCard({ row, href }: { row: LandedCostDocumentRow; href: string }) {
  const { t } = useLocale();
  const title = row.provider?.name ?? "—";
  const fields: RecordGridCardField[] = [
    {
      key: "purchaseInvoice",
      label: t("purchasing.landedCost.fields.purchaseInvoice"),
      value: (
        <SemanticValue kind="id">
          {row.purchaseInvoice?.invoiceNumber ?? row.purchaseInvoiceId}
        </SemanticValue>
      ),
    },
    {
      key: "date",
      label: t("purchasing.landedCost.fields.date"),
      value: <SemanticValue kind="date">{formatDate(row.documentDate)}</SemanticValue>,
    },
  ];
  return (
    <RecordGridCard
      tone={LANDED_COST_STATUS_TONE[row.status]}
      selected={false}
      title={<LocaleText>{title}</LocaleText>}
      href={href}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {row.documentNumber}
        </SemanticValue>
      }
      meta={<MoneyValue value={row.netTotal} currency={row.currency} className="text-foreground" />}
      fields={fields}
      badges={
        <StatusBadge
          label={t(LANDED_COST_STATUS_LABEL_KEY[row.status])}
          tone={LANDED_COST_STATUS_TONE[row.status]}
        />
      }
    />
  );
}
