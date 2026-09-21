"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RECORD_ROUTES, recordHref } from "@/config/traceability/record-routes";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  traceabilityService,
  type TraceGroup,
  type TraceKind,
  type TraceRecord,
  type TraceResult,
} from "@/services/traceability-service";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, StatusTone> = {
  POSTED: "success",
  CONFIRMED: "success",
  VERIFIED: "success",
  CAPITALIZED: "success",
  ACTIVE: "success",
  COMPLETED: "success",
  CLOSED: "neutral",
  DELIVERED: "success",
  APPROVED: "info",
  MATCHED: "info",
  PENDING_APPROVAL: "warning",
  PENDING: "warning",
  DRAFT: "neutral",
  REVERSED: "warning",
  CANCELLED: "destructive",
  REJECTED: "destructive",
  DISPOSED: "neutral",
};

const STATE_TEXT: Record<Exclude<TraceGroup["state"], "FOUND">, MessageKey> = {
  PENDING: "docFlow.trace.state.PENDING",
  FAILED: "docFlow.trace.state.FAILED",
  UNAUTHORIZED: "docFlow.trace.state.UNAUTHORIZED",
  NOT_APPLICABLE: "docFlow.trace.none",
};

function statusLabel(t: (key: MessageKey) => string, status: string | null): string | null {
  if (!status) return null;
  const key = `docFlow.status.${status}` as MessageKey;
  const translated = t(key);
  return translated === key ? status.replaceAll("_", " ").toLowerCase() : translated;
}

function RecordChip({
  record,
  onOpen,
}: {
  record: TraceRecord;
  onOpen: (record: TraceRecord) => void;
}) {
  const { t } = useLocale();
  const href = recordHref(record.kind, record.id);
  const label = statusLabel(t, record.status);
  const body = (
    <>
      <span className="text-muted-foreground">{t(RECORD_ROUTES[record.kind].labelKey)}</span>
      <code dir="ltr" className="text-caption text-foreground">
        {record.number}
      </code>
      {label ? (
        <StatusBadge label={label} tone={STATUS_TONE[record.status ?? ""] ?? "neutral"} />
      ) : null}
    </>
  );
  const className =
    "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-caption hover:bg-muted/60";
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={() => onOpen(record)}>
      {body}
    </button>
  );
}

function useTrace(kind: TraceKind, id: string | null | undefined, refreshKey?: unknown) {
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    traceabilityService
      .get(kind, id)
      .then(setResult)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [kind, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  return { result, error, loading, reload: load };
}

function TraceGroups({
  result,
  onOpen,
}: {
  result: TraceResult;
  onOpen: (record: TraceRecord) => void;
}) {
  const { t } = useLocale();
  const visible = result.groups.filter((group) => group.state !== "NOT_APPLICABLE");
  if (visible.length === 0) {
    return <p className="text-caption text-muted-foreground">{t("docFlow.trace.none")}</p>;
  }
  return (
    <dl className="flex flex-col gap-2">
      {visible.map((group) => (
        <div key={group.key} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
          <dt className="shrink-0 pt-1 text-caption text-muted-foreground sm:w-36">
            {t(`docFlow.trace.groups.${group.key}` as MessageKey)}
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-1.5">
            {group.state === "FOUND" ? (
              group.items.map((record) => (
                <RecordChip key={`${record.kind}-${record.id}`} record={record} onOpen={onOpen} />
              ))
            ) : (
              <span
                className={cn(
                  "pt-1 text-caption",
                  group.state === "FAILED"
                    ? "font-medium text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {t(STATE_TEXT[group.state])}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The ONE related-records control: every document, Journal Entry and stock
 * movement shows its upstream/downstream records here from the canonical
 * traceability endpoint. Records without a page of their own open in
 * place. Pass `refreshKey` (e.g. the document status) to reload after a
 * transition.
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
  const { result, error, loading, reload } = useTrace(kind, id, refreshKey);
  const [opened, setOpened] = useState<TraceRecord | null>(null);

  if (!id) return null;

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
      ) : error ? (
        <p className="flex items-center gap-2 text-caption text-destructive">
          {t("docFlow.trace.loadFailed")}
          <EnterpriseButton type="button" size="xs" variant="ghost" onClick={reload}>
            {t("common.retry")}
          </EnterpriseButton>
        </p>
      ) : result ? (
        <TraceGroups result={result} onOpen={setOpened} />
      ) : null}
      {opened ? <RelatedRecordDialog record={opened} onClose={() => setOpened(null)} /> : null}
    </section>
  );
}

/** In-place view for a record that has no page of its own. */
function RelatedRecordDialog({ record, onClose }: { record: TraceRecord; onClose: () => void }) {
  const { t } = useLocale();
  const { result, error, loading } = useTrace(record.kind, record.id);
  const [nested, setNested] = useState<TraceRecord | null>(null);
  return (
    <EnterpriseModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="md"
      title={`${t(RECORD_ROUTES[record.kind].labelKey)} ${record.number}`}
      footer={(close) => (
        <EnterpriseButton type="button" variant="outline" size="sm" onClick={close}>
          {t("common.close")}
        </EnterpriseButton>
      )}
    >
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : error || !result ? (
        <p className="text-caption text-destructive">{t("docFlow.trace.loadFailed")}</p>
      ) : (
        <TraceGroups result={result} onOpen={setNested} />
      )}
      {nested ? <RelatedRecordDialog record={nested} onClose={() => setNested(null)} /> : null}
    </EnterpriseModal>
  );
}
