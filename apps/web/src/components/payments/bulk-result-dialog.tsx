"use client";

import { CheckCircle2, ListChecks } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { BulkItemsResult } from "@/services/payments-review-service";

/**
 * After a server bulk payment action: how many were done and, for every
 * refused record, the server's own reason — never a silent partial success.
 */
export function BulkResultDialog<S>({
  result,
  label,
  onClose,
}: {
  result: BulkItemsResult<S> | null;
  /** Human label of a failed id (payment number, provider reference…). */
  label: (id: string) => string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  return (
    <EnterpriseModal
      open={!!result}
      onOpenChange={(open) => !open && onClose()}
      size="md"
      icon={ListChecks}
      title={t("paymentVocabulary.bulk.resultTitle")}
      description={
        result
          ? result.failed.length === 0
            ? t("paymentVocabulary.bulk.allDone", { count: result.succeeded.length })
            : t("paymentVocabulary.bulk.partial", {
                succeeded: result.succeeded.length,
                failed: result.failed.length,
              })
          : undefined
      }
      footer={(close) => (
        <EnterpriseButton variant="outline" onClick={close}>
          {t("common.close")}
        </EnterpriseButton>
      )}
    >
      {result ? (
        <div className="flex flex-col gap-3" data-testid="bulk-result">
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              label={t("paymentVocabulary.bulk.succeeded", { count: result.succeeded.length })}
              tone="success"
            />
            {result.failed.length > 0 ? (
              <StatusBadge
                label={t("paymentVocabulary.bulk.failed", { count: result.failed.length })}
                tone="destructive"
              />
            ) : null}
          </div>
          {result.failed.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-caption font-semibold">
                {t("paymentVocabulary.bulk.failedList")}
              </h3>
              <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
                {result.failed.map((failure) => (
                  <li key={failure.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="text-body font-medium" dir="auto">
                      {label(failure.id)}
                    </span>
                    <span className="text-caption text-destructive">{failure.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="flex items-center gap-1.5 text-body text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {t("paymentVocabulary.bulk.allDone", { count: result.succeeded.length })}
            </p>
          )}
        </div>
      ) : null}
    </EnterpriseModal>
  );
}
