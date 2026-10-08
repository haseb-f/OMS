"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { DetailFieldRow, DetailGroup } from "@/components/shared/detail-workspace";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError } from "@/lib/toast";
import { storeOrderMoneyService, type StoreOrderReturn } from "./store-order-money-service";
import { StoreOrderReceiveReturnDialog } from "./store-order-receive-return-dialog";

const REQUESTED = ["DRAFT", "PENDING_APPROVAL", "APPROVED"];
const RECEIVED = ["CONFIRMED", "CLOSED"];

/**
 * On a sales return raised from a store order (R15, D15-10): the order it
 * belongs to, the customer's reason and its state in the return flow —
 * "Requested" until the goods are received and inspected, then "Received" —
 * with the "Receive & inspect" action while it is requested.
 */
export function StoreOrderReturnNotice({
  salesReturnId,
  status,
  reason,
  storeOrder,
  onReceived,
}: {
  salesReturnId: string;
  status: string;
  reason: string | null;
  storeOrder: { id: string; internalOrderId: string };
  onReceived: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [receiveTarget, setReceiveTarget] = useState<StoreOrderReturn | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const requested = REQUESTED.includes(status);
  const received = RECEIVED.includes(status);

  const openReceive = async () => {
    setIsOpening(true);
    try {
      const overview = await storeOrderMoneyService.returns(storeOrder.id);
      setReceiveTarget(overview.returns.find((row) => row.id === salesReturnId) ?? null);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <DetailGroup
      title={t("storeOrderMoney.returnNotice.title")}
      actions={
        requested && hasPermission("sales.returns.confirm") ? (
          <EnterpriseButton
            type="button"
            size="sm"
            variant="outline"
            isLoading={isOpening}
            onClick={() => void openReceive()}
          >
            <PackageCheck />
            {t("storeOrderMoney.actions.receive")}
          </EnterpriseButton>
        ) : null
      }
    >
      <DetailFieldRow
        label={t("docFlow.kinds.STORE_ORDER")}
        value={
          <RelatedRecordLink
            kind="STORE_ORDER"
            id={storeOrder.id}
            number={storeOrder.internalOrderId}
            variant="inline"
          />
        }
      />
      {requested || received ? (
        <DetailFieldRow
          label={t("common.status")}
          value={
            <StatusBadge
              label={
                requested
                  ? t("storeOrderMoney.panel.returnRequested")
                  : t("storeOrderMoney.panel.returnReceived")
              }
              tone={requested ? "warning" : "success"}
            />
          }
        />
      ) : null}
      <DetailFieldRow label={t("storeOrderMoney.returnDialog.reason")} value={reason} />
      {receiveTarget ? (
        <StoreOrderReceiveReturnDialog
          storeOrderId={storeOrder.id}
          salesReturn={receiveTarget}
          onOpenChange={(open) => !open && setReceiveTarget(null)}
          onReceived={onReceived}
        />
      ) : null}
    </DetailGroup>
  );
}
