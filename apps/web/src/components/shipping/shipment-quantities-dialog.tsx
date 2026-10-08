"use client";

import { useEffect, useMemo, useState } from "react";
import { PackageCheck, Truck } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import {
  StockQuantityTable,
  type StockQuantityRow,
} from "@/components/store-orders/stock/stock-quantity-table";
import {
  storeOrderStockApi,
  type LineQuantity,
  type StoreOrderStockView,
} from "@/components/store-orders/stock/stock-api";

type Mode = "dispatch" | "deliver";

/** Per-line bounds of the current attempt (pure, so the defaults are unit-tested). */
export function shipmentQuantityPlan(
  view: StoreOrderStockView,
  mode: Mode,
): Array<{ storeOrderItemId: string; sku: string; name: string; max: number; carried: number }> {
  const current = view.shipments.at(-1);
  if (mode === "deliver") {
    return (current?.lines ?? [])
      .map((line) => {
        const item = view.lines.find((l) => l.storeOrderItemId === line.storeOrderItemId);
        return {
          storeOrderItemId: line.storeOrderItemId,
          sku: item?.sku ?? "",
          name: item?.name ?? "",
          // Never more than the order still has to deliver (the server caps it too).
          max: Math.max(
            Math.min(
              line.quantity - line.returnedQuantity,
              (item?.ordered ?? 0) - (item?.delivered ?? 0),
            ),
            0,
          ),
          carried: 0,
        };
      })
      .filter((row) => row.max > 0);
  }
  // A reship carries what the previous attempt still has with the carrier.
  const previous = current?.isReship
    ? view.shipments
        .slice(0, -1)
        .filter((s) => s.lines.length > 0)
        .at(-1)
    : undefined;
  return view.lines
    .filter((line) => line.stockLine)
    .map((line) => {
      const carried =
        previous?.lines.find((l) => l.storeOrderItemId === line.storeOrderItemId)?.withCarrier ?? 0;
      return {
        storeOrderItemId: line.storeOrderItemId,
        sku: line.sku,
        name: line.name,
        max: carried + line.reserved,
        carried,
      };
    })
    .filter((row) => row.max > 0);
}

/**
 * R15 W5a (D15-5) — dispatch with the quantities this parcel carries
 * (default: everything reserved, plus what a reshipment carries) and delivery
 * with the quantities the customer accepted (default: everything the parcel
 * carried). Agent orders ship and deliver whole (the quantities are shown
 * read-only). Opens on an order whose current attempt is the one to act on;
 * the server validates every quantity again.
 */
export function ShipmentQuantitiesDialog({
  orderId,
  mode,
  open,
  onOpenChange,
  onDone,
}: {
  orderId: string;
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [view, setView] = useState<StoreOrderStockView | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    storeOrderStockApi
      .view(orderId)
      .then((loaded) => {
        if (cancelled) return;
        setView(loaded);
        setValues(
          Object.fromEntries(
            shipmentQuantityPlan(loaded, mode).map((row) => [row.storeOrderItemId, row.max]),
          ),
        );
      })
      .catch((error: unknown) => reportApiError(error, "storeOrderStock.errors.load"));
    return () => {
      cancelled = true;
    };
  }, [open, orderId, mode]);

  const plan = useMemo(() => (view ? shipmentQuantityPlan(view, mode) : []), [view, mode]);
  const whole = view?.isAgentOrder ?? false;

  const submit = async () => {
    setSaving(true);
    const lines: LineQuantity[] | undefined = whole
      ? undefined
      : plan.map((row) => ({
          storeOrderItemId: row.storeOrderItemId,
          quantity: values[row.storeOrderItemId] ?? 0,
        }));
    try {
      if (mode === "dispatch") {
        await storeOrderStockApi.ship(orderId, lines);
        toast.success(t("storeOrderStock.toasts.dispatched"));
      } else {
        await storeOrderStockApi.deliver(orderId, plan.length > 0 ? lines : undefined);
        toast.success(t("storeOrderStock.toasts.delivered"));
      }
      onOpenChange(false);
      onDone();
    } catch (error) {
      reportApiError(
        error,
        mode === "dispatch" ? "storeOrderStock.errors.dispatch" : "storeOrderStock.errors.deliver",
      );
    } finally {
      setSaving(false);
    }
  };

  const rows: StockQuantityRow[] = plan.map((row) => ({
    storeOrderItemId: row.storeOrderItemId,
    sku: row.sku,
    name: row.name,
    max: row.max,
    hint:
      mode === "deliver"
        ? t("storeOrderStock.deliver.inParcel", { count: row.max })
        : row.carried > 0
          ? t("storeOrderStock.dispatch.carried", { count: row.carried })
          : t("storeOrderStock.dispatch.reserved", { count: row.max }),
  }));

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={mode === "dispatch" ? Truck : PackageCheck}
      title={t(
        mode === "dispatch" ? "storeOrderStock.dispatch.title" : "storeOrderStock.deliver.title",
      )}
      description={t(
        mode === "dispatch"
          ? "storeOrderStock.dispatch.description"
          : "storeOrderStock.deliver.description",
      )}
      testId={`shipment-${mode}-dialog`}
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={() => void submit()}
            disabled={saving || !view || (mode === "dispatch" && plan.length === 0)}
          >
            {t(
              mode === "dispatch"
                ? "storeOrderStock.dispatch.submit"
                : "storeOrderStock.deliver.submit",
            )}
          </EnterpriseButton>
        </>
      )}
    >
      {!view ? (
        <Skeleton className="h-24 w-full" />
      ) : plan.length === 0 ? (
        mode === "dispatch" ? (
          <p className="text-caption text-muted-foreground">
            {t("storeOrderStock.dispatch.nothing")}
          </p>
        ) : null
      ) : (
        <div className="flex flex-col gap-2">
          {whole ? (
            <p className="text-caption text-muted-foreground">
              {t("storeOrderStock.dispatch.shipsWhole")}
            </p>
          ) : null}
          <StockQuantityTable
            rows={rows}
            values={values}
            onChange={(id, quantity) => setValues((current) => ({ ...current, [id]: quantity }))}
            quantityLabel={t(
              mode === "dispatch"
                ? "storeOrderStock.dispatch.quantity"
                : "storeOrderStock.deliver.accepted",
            )}
            disabled={saving || whole}
          />
        </div>
      )}
    </EnterpriseModal>
  );
}
