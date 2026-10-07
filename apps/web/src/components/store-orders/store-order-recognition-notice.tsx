"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import type {
  StoreOrderRecognitionError,
  StoreOrderRecognitionStatus,
} from "@/services/store-orders-service";

/**
 * R14 W3 — the order card notice for its delivery-time recognition:
 *  - FAILED (red): the delivery was saved but no invoice / stock issue / COGS
 *    was posted — the actionable reason(s) and "Retry recognition";
 *  - a reservation failure at shipment (amber): stock could not be held;
 *  - RETURN_PENDING (amber): returned after delivery, post the sales return.
 * Renders nothing otherwise.
 */
export function StoreOrderRecognitionNotice({
  status,
  error,
  attemptedAt,
  invoiceNumber,
  canRetry,
  retrying,
  onRetry,
}: {
  status: StoreOrderRecognitionStatus | null | undefined;
  error: StoreOrderRecognitionError | null | undefined;
  attemptedAt?: string | null;
  invoiceNumber?: string | null;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t, locale } = useLocale();
  const message = (issue: { messageAr: string; messageEn: string }) =>
    locale === "ar" ? issue.messageAr : issue.messageEn;

  if (status === "RETURN_PENDING") {
    return (
      <Alert tone="warning" data-testid="recognition-return-pending">
        <AlertTriangle />
        <div className="flex flex-col gap-0.5">
          <AlertTitle>{t("storeOrderRecognition.returnPending.title")}</AlertTitle>
          <AlertDescription>
            {t("storeOrderRecognition.returnPending.description", {
              invoice: invoiceNumber ?? "—",
            })}
          </AlertDescription>
        </div>
      </Alert>
    );
  }

  const failed = status === "FAILED";
  const reservationFailed = !failed && error?.stage === "RESERVATION";
  if (!error || (!failed && !reservationFailed)) return null;
  const issues = error.issues?.length ? error.issues : [error];

  return (
    <Alert
      tone={failed ? "destructive" : "warning"}
      data-testid={failed ? "recognition-failed" : "recognition-reservation-failed"}
      data-code={error.code}
    >
      <AlertTriangle />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <AlertTitle>
          {t(
            failed
              ? "storeOrderRecognition.failed.title"
              : "storeOrderRecognition.reservationFailed.title",
          )}
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-1">
          <span>
            {t(
              failed
                ? "storeOrderRecognition.failed.description"
                : "storeOrderRecognition.reservationFailed.description",
            )}
          </span>
          <ul className="list-disc ps-4">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{message(issue)}</li>
            ))}
          </ul>
          {attemptedAt ? (
            <span className="text-muted-foreground">
              {t("storeOrderRecognition.failed.lastAttempt", {
                date: formatDateTime(attemptedAt),
              })}
            </span>
          ) : null}
        </AlertDescription>
        {failed && canRetry ? (
          <div>
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              disabled={retrying}
              onClick={onRetry}
              data-testid="recognition-retry"
            >
              <RotateCcw className="size-3.5" />
              {t(retrying ? "storeOrderRecognition.retrying" : "storeOrderRecognition.retry")}
            </EnterpriseButton>
          </div>
        ) : null}
      </div>
    </Alert>
  );
}
