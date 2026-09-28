"use client";

import { Suspense } from "react";
import { PackageSlipTemplate } from "@/components/print/templates";
import { PrintJobExpired, usePrintJob } from "@/components/print/print-job";
import type { PackageSlipPayload } from "@/types/print-engine";

function PrintSlipContent() {
  const payload = usePrintJob<PackageSlipPayload>();
  if (payload === undefined) return null;
  if (!payload) return <PrintJobExpired />;
  return <PackageSlipTemplate payload={payload} />;
}

/** Store-order A5 package slip (specs/print-design-system §4). */
export default function PrintSlipPage() {
  return (
    <Suspense fallback={null}>
      <PrintSlipContent />
    </Suspense>
  );
}
