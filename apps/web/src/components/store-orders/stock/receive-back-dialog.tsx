"use client";

import { useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import { StockQuantityTable } from "./stock-quantity-table";
import { storeOrderStockApi, type ReceiveCondition, type StoreOrderStockView } from "./stock-api";

/**
 * R15 W5a (D15-8) — "Receive returned goods": physical receipt + inspection
 * of goods that came back undelivered (failed / refused delivery, order
 * cancelled in transit). Per line: the received quantity (≤ what is with the
 * carrier) and its condition. One receipt key per opening, so a double
 * submit never receives twice.
 */
export function ReceiveBackDialog({
  view,
  open,
  onOpenChange,
  onReceived,
}: {
  view: StoreOrderStockView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReceived: (view: StoreOrderStockView) => void;
}) {
  const { t } = useLocale();
  const lines = useMemo(() => view.lines.filter((line) => line.inTransit > 0), [view.lines]);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((line) => [line.storeOrderItemId, line.inTransit])),
  );
  const [conditions, setConditions] = useState<Record<string, ReceiveCondition>>({});
  const [receiptKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const chosen = lines.filter((line) => (quantities[line.storeOrderItemId] ?? 0) > 0);

  const submit = async () => {
    if (chosen.length === 0) {
      toast.error(t("storeOrderStock.receive.empty"));
      return;
    }
    setSaving(true);
    try {
      const updated = await storeOrderStockApi.receiveBack(view.orderId, {
        idempotencyKey: receiptKey,
        lines: chosen.map((line) => ({
          storeOrderItemId: line.storeOrderItemId,
          quantity: quantities[line.storeOrderItemId],
          condition: conditions[line.storeOrderItemId] ?? "SALEABLE",
        })),
      });
      toast.success(t("storeOrderStock.toasts.received"));
      onReceived(updated);
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "storeOrderStock.errors.receiveBack");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={PackageOpen}
      title={t("storeOrderStock.receive.title")}
      description={t("storeOrderStock.receive.description")}
      testId="stock-receive-back-dialog"
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={() => void submit()} disabled={saving}>
            {t("storeOrderStock.receive.submit")}
          </EnterpriseButton>
        </>
      )}
    >
      <StockQuantityTable
        rows={lines.map((line) => ({
          storeOrderItemId: line.storeOrderItemId,
          sku: line.sku,
          name: line.name,
          max: line.inTransit,
          hint: t("storeOrderStock.receive.withCarrier", { count: line.inTransit }),
          extra: (
            <Select
              value={conditions[line.storeOrderItemId] ?? "SALEABLE"}
              onValueChange={(value) =>
                setConditions((current) => ({
                  ...current,
                  [line.storeOrderItemId]: value as ReceiveCondition,
                }))
              }
            >
              <SelectTrigger className="w-full" aria-label={t("storeOrderStock.receive.condition")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SALEABLE">{t("storeOrderStock.receive.saleable")}</SelectItem>
                <SelectItem value="DAMAGED">{t("storeOrderStock.receive.damaged")}</SelectItem>
              </SelectContent>
            </Select>
          ),
        }))}
        values={quantities}
        onChange={(id, quantity) => setQuantities((current) => ({ ...current, [id]: quantity }))}
        quantityLabel={t("storeOrderStock.receive.quantity")}
        extraLabel={t("storeOrderStock.receive.condition")}
        disabled={saving}
      />
    </EnterpriseModal>
  );
}
