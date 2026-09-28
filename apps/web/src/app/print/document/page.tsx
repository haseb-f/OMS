"use client";

import { Suspense } from "react";
import {
  AccountStatementPrintTemplate,
  InvoicePrintTemplate,
  ReceiptPrintTemplate,
  StatementPrintTemplate,
  VoucherPrintTemplate,
} from "@/components/print/templates";
import { PrintJobExpired, usePrintJob } from "@/components/print/print-job";
import type { DocumentPrintPayload, StatementPrintPayload } from "@/types/print-engine";

const TEMPLATES_BY_VARIANT = {
  invoice: InvoicePrintTemplate,
  statement: StatementPrintTemplate,
  receipt: ReceiptPrintTemplate,
  voucher: VoucherPrintTemplate,
} as const;

function PrintDocumentContent() {
  const payload = usePrintJob<DocumentPrintPayload | StatementPrintPayload>();
  if (payload === undefined) return null;
  if (!payload) return <PrintJobExpired />;
  if (payload.variant === "account-statement") {
    return <AccountStatementPrintTemplate payload={payload} />;
  }
  const Template = TEMPLATES_BY_VARIANT[payload.variant];
  return <Template payload={payload} />;
}

export default function PrintDocumentPage() {
  return (
    <Suspense fallback={null}>
      <PrintDocumentContent />
    </Suspense>
  );
}
