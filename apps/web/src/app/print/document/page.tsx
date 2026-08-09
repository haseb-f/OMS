"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  InvoicePrintTemplate,
  StatementPrintTemplate,
  ReceiptPrintTemplate,
  VoucherPrintTemplate,
} from "@/components/print/templates";
import { useTriggerPrint } from "@/components/print/use-trigger-print";
import { readPrintJob } from "@/lib/print-bridge";
import type { DocumentPrintPayload } from "@/types/print-engine";

const TEMPLATES_BY_VARIANT = {
  invoice: InvoicePrintTemplate,
  statement: StatementPrintTemplate,
  receipt: ReceiptPrintTemplate,
  voucher: VoucherPrintTemplate,
} as const;

function PrintDocumentContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job");
  const [payload, setPayload] = useState<DocumentPrintPayload | null | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPayload(jobId ? readPrintJob<DocumentPrintPayload>(jobId) : null);
  }, [jobId]);

  useTriggerPrint(!!payload);

  if (payload === undefined) return null;
  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        This print job has expired. Close this tab and print again.
      </div>
    );
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
