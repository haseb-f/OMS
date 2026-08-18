"use client";

import { useCallback, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { ApiError } from "@/services/api-client";
import {
  syncService,
  type ListSheetColumnKey,
  type ListSheetSyncResult,
} from "@/services/sync-service";
import type { MessageKey } from "@/i18n/translate";

const LIST_LABEL_KEY: Record<ListSheetColumnKey, MessageKey> = {
  country: "importCenter.sync.listSheet.lists.country",
  product: "importCenter.sync.listSheet.lists.product",
  currency: "importCenter.sync.listSheet.lists.currency",
  paymentMethod: "importCenter.sync.listSheet.lists.paymentMethod",
  employeeEmail: "importCenter.sync.listSheet.lists.employeeEmail",
  shippingStatus: "importCenter.sync.listSheet.lists.shippingStatus",
  shippingCompany: "importCenter.sync.listSheet.lists.shippingCompany",
};

function listSheetErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const raw = error.message.trim();
  if (!raw || raw.includes("\n") || /google\.|googleapis|ECONN/i.test(raw)) {
    return fallback;
  }
  return raw;
}

function countOf(result: ListSheetSyncResult, key: ListSheetColumnKey): number {
  return result.lists.find((list) => list.key === key)?.count ?? 0;
}

/**
 * OMS → List Sheet action. Lives in the shared sync workspace; uses the
 * same Button primitive as inbound Sync, with the amber reference-sync
 * treatment. Not a one-off card component.
 */
export function ListSheetSyncButton({
  onSynced,
  onResult,
}: {
  onSynced?: () => void;
  onResult?: (result: ListSheetSyncResult) => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canSync = hasPermission("import-center.sync");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "partial" | "error">("idle");
  const inFlightRef = useRef(false);

  const handleClick = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setStatus("idle");
    try {
      const result = await syncService.publishListSheet();
      onResult?.(result);
      if (result.status === "SUCCESS") {
        setStatus("success");
        toast.success(t("importCenter.sync.listSheet.success"), {
          description: t("importCenter.sync.listSheet.summary", {
            countries: countOf(result, "country"),
            products: countOf(result, "product"),
            currencies: countOf(result, "currency"),
            paymentMethods: countOf(result, "paymentMethod"),
            employees: countOf(result, "employeeEmail"),
            shippingStatuses: countOf(result, "shippingStatus"),
            shippingCompanies: countOf(result, "shippingCompany"),
            datetime: formatDateTime(result.syncedAt),
          }),
        });
      } else if (result.status === "PARTIAL") {
        setStatus("partial");
        const failed = result.lists
          .filter((list) => list.status === "FAILED")
          .map((list) => t(LIST_LABEL_KEY[list.key]))
          .join("، ");
        toast.warning(t("importCenter.sync.listSheet.partial"), {
          description: t("importCenter.sync.listSheet.partialDetail", { lists: failed }),
        });
      } else {
        setStatus("error");
        const failedMessage = result.lists.find((list) => list.message)?.message;
        toast.error(t("importCenter.sync.listSheet.failed"), {
          description: failedMessage || t("importCenter.sync.listSheet.errors.generic"),
        });
      }
      onSynced?.();
    } catch (error) {
      setStatus("error");
      toast.error(listSheetErrorMessage(error, t("importCenter.sync.listSheet.errors.generic")));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [onResult, onSynced, t]);

  if (!canSync) return null;

  const label = loading
    ? t("importCenter.sync.listSheet.loading")
    : t("importCenter.sync.listSheet.button");

  return (
    <EnterpriseButton
      type="button"
      variant="warning"
      onClick={handleClick}
      disabled={loading}
      aria-label={t("importCenter.sync.listSheet.button")}
      aria-busy={loading || undefined}
      aria-live="polite"
      data-sync-status={status}
      className="h-auto min-h-(--control-height-md) w-full gap-2 rounded-md px-3 py-1.5 text-[length:var(--text-button)] ring-1 ring-warning-foreground/15 transition-shadow"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-warning-foreground/15">
        <CloudUpload className={cn("size-3.5", loading && "animate-spin")} />
      </span>
      {label}
    </EnterpriseButton>
  );
}
