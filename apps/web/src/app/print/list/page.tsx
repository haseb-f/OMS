"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GenericListPrintTemplate } from "@/components/print/templates";
import { useTriggerPrint } from "@/components/print/use-trigger-print";
import { readPrintJob } from "@/lib/print-bridge";
import { useLocale } from "@/providers/locale-provider";
import type { GenericListPrintPayload } from "@/types/print-engine";

function PrintListContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job");
  const [payload, setPayload] = useState<GenericListPrintPayload | null | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPayload(jobId ? readPrintJob<GenericListPrintPayload>(jobId) : null);
  }, [jobId]);

  useTriggerPrint(!!payload);

  if (payload === undefined) return null;
  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        {t("reportExport.printExpired")}
      </div>
    );
  }

  return <GenericListPrintTemplate payload={payload} />;
}

export default function PrintListPage() {
  return (
    <Suspense fallback={null}>
      <PrintListContent />
    </Suspense>
  );
}
