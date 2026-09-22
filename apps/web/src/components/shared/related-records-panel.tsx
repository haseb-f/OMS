"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RecordPreviewDialog,
  TraceGroups,
  recordTitle,
  useTrace,
} from "@/components/shared/record-preview";
import { useLocale } from "@/providers/locale-provider";
import type { TraceKind } from "@/services/traceability-service";
import { cn } from "@/lib/utils";

/**
 * The ONE related-records control: every document, Journal Entry and stock
 * movement shows its upstream/downstream records here from the canonical
 * traceability endpoint. Each record opens a compact preview in place;
 * "Open full record" navigates with a return trail back to this document.
 * Pass `refreshKey` (e.g. the document status) to reload after a transition.
 */
export function RelatedRecordsPanel({
  kind,
  id,
  refreshKey,
  className,
}: {
  kind: TraceKind;
  id: string | null | undefined;
  refreshKey?: unknown;
  className?: string;
}) {
  const { t } = useLocale();
  const { result, error, forbidden, loading, reload } = useTrace(kind, id, refreshKey);

  if (!id) return null;
  const originLabel = result?.record ? recordTitle(t, kind, result.record.number) : undefined;

  return (
    <section
      aria-label={t("docFlow.trace.title")}
      className={cn("rounded-md border border-border bg-muted/20 px-3 py-2", className)}
    >
      <h2 className="mb-1.5 flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
        <Link2 className="size-3.5" />
        {t("docFlow.trace.title")}
      </h2>
      {loading && !result ? (
        <div className="flex gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-7 w-28" />
        </div>
      ) : error && forbidden ? (
        <p className="text-caption text-warning-foreground">
          {t("docFlow.trace.state.UNAUTHORIZED")}
        </p>
      ) : error ? (
        <p className="flex items-center gap-2 text-caption text-destructive">
          {t("docFlow.trace.loadFailed")}
          <EnterpriseButton type="button" size="xs" variant="ghost" onClick={reload}>
            {t("common.retry")}
          </EnterpriseButton>
        </p>
      ) : result ? (
        <TraceGroups result={result} originLabel={originLabel} />
      ) : null}
    </section>
  );
}

/** Compact table-cell trigger that opens a record's preview/related records in place. */
export function RelatedRecordsButton({
  kind,
  id,
  number,
}: {
  kind: TraceKind;
  id: string;
  number: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="xs"
        className="gap-1 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Link2 className="size-3" />
        {t("docFlow.trace.view")}
      </EnterpriseButton>
      {open ? (
        <RecordPreviewDialog
          record={{ kind, id, number, status: null }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
