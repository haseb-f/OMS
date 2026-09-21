"use client";

import { useEffect, useMemo, useState } from "react";
import { Tags } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { storeOrdersService, type StoreOrderRow } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatMoney } from "@/lib/money";

function lineAmount(item: StoreOrderRow["items"][number]): number {
  if (item.agreedAmount != null && item.agreedAmount !== "") return Number(item.agreedAmount);
  return Number(item.quantity) * Number(item.unitPrice);
}

/**
 * Pricing correction for a Store Order saved without its agreed amounts —
 * the user enters the amounts the customer agreed to (never a catalogue
 * price). The server only allows this before any invoice or verified
 * payment and logs every change on the order timeline.
 */
export function StoreOrderLineAmountsDialog({
  orderId,
  open,
  onOpenChange,
  onSaved,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (order: StoreOrderRow) => void;
}) {
  const { t } = useLocale();
  const [order, setOrder] = useState<StoreOrderRow | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(null);
    storeOrdersService
      .get(orderId)
      .then((row) => {
        if (cancelled) return;
        setOrder(row);
        setAmounts(
          Object.fromEntries(
            row.items.map((item) => {
              const amount = lineAmount(item);
              return [item.id, amount > 0 ? String(amount) : ""];
            }),
          ),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
        onOpenChange(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId, onOpenChange, t]);

  const total = useMemo(
    () => Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [amounts],
  );
  const isDirty =
    !!order && order.items.some((item) => (Number(amounts[item.id]) || 0) !== lineAmount(item));

  const handleSave = async () => {
    if (!order || !orderId) return;
    if (total <= 0) {
      toast.error(t("storeOrders.lineAmounts.totalRequired"));
      return;
    }
    setIsSaving(true);
    try {
      const saved = await storeOrdersService.setLineAmounts(
        orderId,
        order.items.map((item) => ({
          itemId: item.id,
          agreedAmount: Number(amounts[item.id]) || 0,
        })),
      );
      toast.success(
        t("storeOrders.lineAmounts.saved", {
          order: order.internalOrderId,
          total: formatMoney(total),
        }),
      );
      onOpenChange(false);
      onSaved(saved);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={Tags}
      title={t("storeOrders.lineAmounts.title")}
      description={t("storeOrders.lineAmounts.description", {
        order: order?.internalOrderId ?? "",
      })}
      isDirty={isDirty}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
          submitDisabled={!order || total <= 0}
        />
      )}
    >
      {!order ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="line-amounts-dialog">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium">
                  {item.product?.name ?? item.productId}
                </p>
                <p className="text-caption text-muted-foreground">
                  {t("storeOrders.lineAmounts.quantity", { quantity: item.quantity })}
                </p>
              </div>
              <Input
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                inputSize="compact-md"
                className="w-(--width-control-price) text-end tabular-nums"
                aria-label={t("storeOrders.lineAmounts.agreedAmount")}
                placeholder="0.00"
                value={amounts[item.id] ?? ""}
                onChange={(event) =>
                  setAmounts((current) => ({ ...current, [item.id]: event.target.value }))
                }
              />
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-body font-semibold">
            <span>{t("storeOrders.lineAmounts.total")}</span>
            <span dir="ltr" className="tabular-nums">
              {formatMoney(total, order.currency?.code)}
            </span>
          </div>
        </div>
      )}
    </EnterpriseModal>
  );
}
