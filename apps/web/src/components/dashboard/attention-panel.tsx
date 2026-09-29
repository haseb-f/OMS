"use client";

import Link from "next/link";
import {
  BellRing,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  Inbox,
  Landmark,
  ReceiptText,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { DashboardPanel, PanelSkeleton } from "@/components/dashboard/dashboard-panel";
import type { AttentionKey, AttentionQueue } from "@/components/dashboard/dashboard-data";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

const QUEUE_COPY: Record<
  AttentionKey,
  { icon: LucideIcon; title: MessageKey; hint: MessageKey; action: MessageKey }
> = {
  overdue: {
    icon: BellRing,
    title: "crm.leads.dashboard.overdue",
    hint: "docUi.dashboard.overdueHint",
    action: "docUi.dashboard.actionOverdue",
  },
  dueToday: {
    icon: CalendarClock,
    title: "crm.leads.dashboard.dueToday",
    hint: "docUi.dashboard.dueTodayHint",
    action: "docUi.dashboard.actionDueToday",
  },
  paymentReview: {
    icon: ReceiptText,
    title: "docUi.dashboard.paymentReview",
    hint: "docUi.dashboard.paymentReviewHint",
    action: "docUi.dashboard.actionPaymentReview",
  },
  bankReview: {
    icon: Scale,
    title: "docUi.dashboard.bankReview",
    hint: "docUi.dashboard.bankReviewHint",
    action: "docUi.dashboard.actionBankReview",
  },
  bankUnmatched: {
    icon: Landmark,
    title: "docUi.dashboard.bankUnmatched",
    hint: "docUi.dashboard.bankUnmatchedHint",
    action: "docUi.dashboard.actionBankUnmatched",
  },
};

const ICON_TONE = {
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
} as const;

const ROW_LINK =
  "flex min-w-0 items-center gap-3 px-3 outline-none transition-colors duration-(--duration-base) ease-(--ease-standard) hover:bg-table-row-hover focus-visible:bg-table-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring";

/**
 * Needs attention (design-system §12.6): the actionable queues as one list —
 * open ones first with their count, one-line reason and a link; queues with
 * nothing waiting stay listed as "clear" in a quieter row.
 */
export function AttentionPanel({
  open,
  cleared,
  loading,
  failed,
  partialFailed,
  onRetry,
}: {
  open: AttentionQueue[];
  cleared: AttentionQueue[];
  loading: boolean;
  failed: boolean;
  partialFailed: boolean;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const settled = !loading && !failed && !partialFailed;

  return (
    <DashboardPanel
      id="dash-attention"
      icon={Inbox}
      title={t("docUi.dashboard.attentionTitle")}
      description={t("docUi.dashboard.attentionDescription")}
      busy={loading}
      badge={
        settled ? (
          <EnterpriseBadge variant={open.length > 0 ? "warning" : "success"}>
            {open.length > 0 ? null : <CircleCheck />}
            {open.length > 0
              ? t("docUi.dashboard.openQueues", { count: open.length })
              : t("docUi.dashboard.allClear")}
          </EnterpriseBadge>
        ) : undefined
      }
    >
      {failed ? (
        <ErrorState description={t("docUi.dashboard.loadFailed")} onRetry={onRetry} />
      ) : loading ? (
        <PanelSkeleton rows={3} />
      ) : (
        <>
          {partialFailed ? (
            <p
              role="alert"
              className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-caption text-muted-foreground"
            >
              {t("docUi.dashboard.loadFailed")}
              <EnterpriseButton type="button" variant="link" size="inline" onClick={onRetry}>
                {t("common.retry")}
              </EnterpriseButton>
            </p>
          ) : null}
          {open.length === 0 && !partialFailed ? (
            <EmptyState
              icon={CircleCheck}
              title={t("dashboard.overview.queuesClear")}
              description={t("dashboard.overview.attentionEmptyHint")}
              className="py-5"
            />
          ) : null}
          <ul className="divide-y divide-border">
            {open.map((queue) => (
              <OpenQueueRow key={queue.key} queue={queue} />
            ))}
            {cleared.map((queue) => (
              <li key={queue.key}>
                <Link href={queue.href} className={cn(ROW_LINK, "h-9 text-caption")}>
                  <CircleCheck
                    className="size-4 shrink-0 text-success-soft-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {t(QUEUE_COPY[queue.key].title)}
                  </span>
                  <span className="shrink-0 text-placeholder">{t("docUi.dashboard.allClear")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashboardPanel>
  );
}

function OpenQueueRow({ queue }: { queue: AttentionQueue }) {
  const { t } = useLocale();
  const copy = QUEUE_COPY[queue.key];
  const Icon = copy.icon;
  return (
    <li>
      <Link
        href={queue.href}
        className={cn(ROW_LINK, "group/queue py-2.5")}
        aria-label={`${t(copy.title)}: ${queue.count} — ${t(copy.action)}`}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-sm",
            ICON_TONE[queue.severity],
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-foreground">{t(copy.title)}</span>
          <span className="truncate text-caption text-muted-foreground">{t(copy.hint)}</span>
        </span>
        <span
          className={cn(
            "num shrink-0 text-card-title font-semibold",
            queue.severity === "destructive"
              ? "text-destructive-soft-foreground"
              : "text-foreground",
          )}
        >
          {queue.count}
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/queue:text-foreground rtl:rotate-180"
          aria-hidden
        />
      </Link>
    </li>
  );
}
