"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RECORD_ROUTES, recordHref } from "@/config/traceability/record-routes";
import {
  hasRecordPreview,
  loadRecordPreview,
  type RecordPreview,
} from "@/config/traceability/record-previews";
import { pushOrigin } from "@/lib/navigation-origin";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  traceabilityService,
  type TraceGroup,
  type TraceKind,
  type TraceRecord,
  type TraceResult,
} from "@/services/traceability-service";

export const RECORD_STATUS_TONE: Record<string, StatusTone> = {
  POSTED: "success",
  CONFIRMED: "success",
  VERIFIED: "success",
  CAPITALIZED: "success",
  ACTIVE: "success",
  COMPLETED: "success",
  CLOSED: "neutral",
  DELIVERED: "success",
  PAID: "success",
  APPROVED: "info",
  MATCHED: "info",
  PENDING_APPROVAL: "warning",
  PENDING: "warning",
  PAYMENT_PENDING: "warning",
  PAYMENT_REVIEW: "warning",
  PARTIALLY_PAID: "warning",
  DRAFT: "neutral",
  REVERSED: "warning",
  CANCELLED: "destructive",
  REJECTED: "destructive",
  DISPOSED: "neutral",
};

export function recordStatusLabel(
  t: (key: MessageKey) => string,
  status: string | null | undefined,
): string | null {
  if (!status) return null;
  const key = `docFlow.status.${status}` as MessageKey;
  const translated = t(key);
  return translated === key ? status.replaceAll("_", " ").toLowerCase() : translated;
}

function RecordStatus({ status }: { status: string | null | undefined }) {
  const { t } = useLocale();
  const label = recordStatusLabel(t, status);
  return label ? (
    <StatusBadge label={label} tone={RECORD_STATUS_TONE[status ?? ""] ?? "neutral"} />
  ) : null;
}

export function recordTitle(t: (key: MessageKey) => string, kind: TraceKind, number: string) {
  return `${t(RECORD_ROUTES[kind].labelKey)} ${number}`;
}

/** The current page's own reference, for records opened without one. */
function currentPageLabel(fallback: string): string {
  const heading = document.querySelector("main h1")?.textContent?.trim();
  return heading || fallback;
}

/**
 * Navigates to a record's full page while recording where the user came
 * from, so the destination shows "Back to <origin>" and the origin's
 * filters, scroll and unsaved edits come back on return.
 */
export function useOpenFullRecord() {
  const router = useRouter();
  const { t } = useLocale();
  return useCallback(
    (record: Pick<TraceRecord, "kind" | "id" | "number">, originLabel?: string) => {
      const href = recordHref(record.kind, record.id);
      if (!href) return;
      pushOrigin({
        label: originLabel ?? currentPageLabel(t("docFlow.return.previous")),
        target: href,
        targetLabel: recordTitle(t, record.kind, record.number),
      });
      router.push(href);
    },
    [router, t],
  );
}

export function useTrace(kind: TraceKind, id: string | null | undefined, refreshKey?: unknown) {
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

const STATE_TEXT: Record<Exclude<TraceGroup["state"], "FOUND">, MessageKey> = {
  PENDING: "docFlow.trace.state.PENDING",
  FAILED: "docFlow.trace.state.FAILED",
  UNAUTHORIZED: "docFlow.trace.state.UNAUTHORIZED",
  NOT_APPLICABLE: "docFlow.trace.none",
};

/**
 * The ONE related-record control: a compact chip (or inline reference)
 * that opens the record's preview in place. Full-page navigation happens
 * only from the preview's "Open full record", which records the origin.
 */
export function RelatedRecordLink({
  kind,
  id,
  number,
  status,
  originLabel,
  variant = "chip",
  showKind = variant === "chip",
  className,
}: {
  kind: TraceKind;
  id: string;
  number: string;
  status?: string | null;
  originLabel?: string;
  variant?: "chip" | "inline";
  showKind?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="related-record-link"
        data-kind={kind}
        className={cn(
          variant === "chip"
            ? "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-caption hover:bg-muted/60"
            : "inline-flex max-w-full items-center gap-1.5 text-start hover:underline",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        {showKind ? (
          <span className="text-muted-foreground">{t(RECORD_ROUTES[kind].labelKey)}</span>
        ) : null}
        <code dir="ltr" className="truncate text-caption text-foreground">
          {number}
        </code>
        {variant === "chip" ? <RecordStatus status={status} /> : null}
      </button>
      {open ? (
        <RecordPreviewDialog
          record={{ kind, id, number, status: status ?? null }}
          originLabel={originLabel}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function TraceGroups({
  result,
  originLabel,
}: {
  result: TraceResult;
  originLabel?: string;
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
                <RelatedRecordLink
                  key={`${record.kind}-${record.id}`}
                  kind={record.kind}
                  id={record.id}
                  number={record.number}
                  status={record.status}
                  originLabel={originLabel}
                />
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
                {t(
                  group.key === "PAYMENTS" && group.state === "PENDING"
                    ? "docFlow.trace.state.AWAITING_PAYMENT"
                    : STATE_TEXT[group.state],
                )}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function usePreview(kind: TraceKind, id: string) {
  const [state, setState] = useState<{ preview: RecordPreview | null; error: boolean }>({
    preview: null,
    error: false,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadRecordPreview(kind, id)
      ?.then((preview) => {
        if (active) setState({ preview, error: false });
      })
      .catch(() => {
        if (active) setState({ preview: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [kind, id, attempt]);
  const retry = () => {
    setState({ preview: null, error: false });
    setAttempt((value) => value + 1);
  };
  return { ...state, retry };
}

function PreviewFields({ preview }: { preview: RecordPreview }) {
  const { t } = useLocale();
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-caption sm:grid-cols-2">
      {preview.fields.map((field) => (
        <div
          key={field.labelKey}
          className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 py-1"
        >
          <dt className="shrink-0 text-muted-foreground">{t(field.labelKey)}</dt>
          <dd
            dir={field.ltr ? "ltr" : undefined}
            className="min-w-0 truncate text-end font-medium tabular-nums"
            title={field.value}
          >
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function JournalLinesPreview({ journal }: { journal: NonNullable<RecordPreview["journal"]> }) {
  const { t } = useLocale();
  const balanced = Math.abs(journal.totalDebit - journal.totalCredit) < 0.005;
  const amount = (value: number) => (value ? formatMoney(value) : "");
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-caption" data-testid="record-preview-journal">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-start font-medium">{t("docFlow.preview.account")}</th>
            <th className="w-28 px-2 py-1.5 text-end font-medium">{t("docFlow.preview.debit")}</th>
            <th className="w-28 px-2 py-1.5 text-end font-medium">{t("docFlow.preview.credit")}</th>
          </tr>
        </thead>
        <tbody>
          {journal.lines.map((line) => (
            <tr key={line.id} className="border-t border-border/60 align-top">
              <td className="px-2 py-1.5">
                <div className="font-medium">{line.account}</div>
                {line.description ? (
                  <div className="text-muted-foreground">{line.description}</div>
                ) : null}
              </td>
              <td dir="ltr" className="px-2 py-1.5 text-end tabular-nums whitespace-nowrap">
                {amount(line.debit)}
              </td>
              <td dir="ltr" className="px-2 py-1.5 text-end tabular-nums whitespace-nowrap">
                {amount(line.credit)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-muted/30 font-semibold">
          <tr>
            <td className="px-2 py-1.5">
              <span className="me-2">{t("docFlow.preview.totals")}</span>
              <StatusBadge
                label={t(balanced ? "docFlow.preview.balanced" : "docFlow.preview.unbalanced")}
                tone={balanced ? "success" : "destructive"}
              />
            </td>
            <td dir="ltr" className="px-2 py-1.5 text-end tabular-nums whitespace-nowrap">
              {formatMoney(journal.totalDebit)}
            </td>
            <td dir="ltr" className="px-2 py-1.5 text-end tabular-nums whitespace-nowrap">
              {formatMoney(journal.totalCredit)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function StatusRow({ status }: { status: string | null | undefined }) {
  const { t } = useLocale();
  if (!status) return null;
  return (
    <div className="flex items-center gap-2 text-caption">
      <span className="text-muted-foreground">{t("docFlow.preview.status")}</span>
      <RecordStatus status={status} />
    </div>
  );
}

function PreviewBody({ record }: { record: TraceRecord }) {
  const { t } = useLocale();
  const { preview, error, retry } = usePreview(record.kind, record.id);
  if (error) {
    return (
      <p className="flex items-center gap-2 text-caption text-destructive">
        {t("docFlow.preview.loadFailed")}
        <EnterpriseButton type="button" size="xs" variant="ghost" onClick={retry}>
          {t("common.retry")}
        </EnterpriseButton>
      </p>
    );
  }
  if (!preview) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <StatusRow status={preview.status ?? record.status} />
      <PreviewFields preview={preview} />
      {preview.journal ? <JournalLinesPreview journal={preview.journal} /> : null}
    </div>
  );
}

function TracePreviewBody({ record, originLabel }: { record: TraceRecord; originLabel?: string }) {
  const { t } = useLocale();
  const { result, error, loading } = useTrace(record.kind, record.id);
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (error || !result) {
    return <p className="text-caption text-destructive">{t("docFlow.trace.loadFailed")}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <StatusRow status={record.status ?? result.record?.status} />
      <TraceGroups result={result} originLabel={originLabel} />
    </div>
  );
}

/**
 * Compact in-place preview of any related record: reference, status and
 * key details (Journal Entries add their lines and totals), with "Open
 * full record" when the record has a page of its own.
 */
export function RecordPreviewDialog({
  record,
  originLabel,
  onClose,
}: {
  record: TraceRecord;
  originLabel?: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const openFullRecord = useOpenFullRecord();
  const href = recordHref(record.kind, record.id);
  return (
    <EnterpriseModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="md"
      title={recordTitle(t, record.kind, record.number)}
      footer={(close) => (
        <>
          <EnterpriseButton type="button" variant="outline" size="sm" onClick={close}>
            {t("common.close")}
          </EnterpriseButton>
          {href ? (
            <EnterpriseButton
              type="button"
              size="sm"
              data-testid="record-preview-open-full"
              onClick={() => {
                onClose();
                openFullRecord(record, originLabel);
              }}
            >
              <ExternalLink className="rtl:-scale-x-100" />
              {t("docFlow.preview.openFull")}
            </EnterpriseButton>
          ) : null}
        </>
      )}
    >
      <div data-testid="record-preview">
        {hasRecordPreview(record.kind) ? (
          <PreviewBody record={record} />
        ) : (
          <TracePreviewBody record={record} originLabel={originLabel} />
        )}
      </div>
    </EnterpriseModal>
  );
}
