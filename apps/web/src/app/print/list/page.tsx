"use client";

import { Suspense } from "react";
import { GenericListPrintTemplate } from "@/components/print/templates";
import { PrintJobExpired, usePrintJob } from "@/components/print/print-job";
import type { GenericListPrintPayload } from "@/types/print-engine";

function PrintListContent() {
  const payload = usePrintJob<GenericListPrintPayload>();
  if (payload === undefined) return null;
  if (!payload) return <PrintJobExpired />;
  return <GenericListPrintTemplate payload={payload} />;
}

export default function PrintListPage() {
  return (
    <Suspense fallback={null}>
      <PrintListContent />
    </Suspense>
  );
}
