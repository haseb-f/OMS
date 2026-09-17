"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  carrierReconciliationService,
  type CarrierChargeRow,
} from "@/services/carrier-reconciliation-service";
import { ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";

/**
 * ADR-0018 (Order Economics M2 gap closure) — manual rematch (Part 4/13).
 * Resolves an Order Number to its own Shipment Attempts server-side
 * (`GET /carrier-reconciliation/shipment-candidates`) rather than a generic
 * Shipment search — a carrier charge always matches at most one Order.
 */
export function CarrierChargeMatchDialog({
  charge,
  open,
  onOpenChange,
  onMatched,
}: {
  charge: CarrierChargeRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMatched: () => void;
}) {
  const { t } = useLocale();
  const [orderNumber, setOrderNumber] = useState("");
  const [shipments, setShipments] = useState<
    { id: string; attemptNumber: number; status: string | null; trackingNumber: string | null }[]
  >([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searched, setSearched] = useState(false);

  const reset = () => {
    setOrderNumber("");
    setShipments([]);
    setSelectedShipmentId("");
    setSearched(false);
  };

  const search = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isSearching) return;
    setIsSearching(true);
    carrierReconciliationService
      .shipmentCandidates(trimmed)
      .then((result) => {
        setShipments(result.shipments);
        setSearched(true);
        if (result.shipments.length === 0) {
          toast.error(t("carrierReconciliation.match.noShipments"));
        }
      })
      .catch((error: unknown) => {
        toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
      })
      .finally(() => setIsSearching(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("carrierReconciliation.match.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("carrierReconciliation.match.orderNumber")}</Label>
            <SearchInput
              value={orderNumber}
              onValueChange={setOrderNumber}
              onSubmit={search}
              onClear={reset}
              isLoading={isSearching}
              placeholder={t("carrierReconciliation.match.orderNumberPlaceholder")}
              className="max-w-none"
            />
          </div>

          {searched && shipments.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t("carrierReconciliation.match.shipmentAttempt")}</Label>
              <Select value={selectedShipmentId} onValueChange={setSelectedShipmentId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("carrierReconciliation.match.selectAttempt")} />
                </SelectTrigger>
                <SelectContent>
                  {shipments.map((shipment) => (
                    <SelectItem key={shipment.id} value={shipment.id}>
                      #{shipment.attemptNumber} — {shipment.status ?? "—"}
                      {shipment.trackingNumber ? ` (${shipment.trackingNumber})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <EnterpriseButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            disabled={!charge || !selectedShipmentId || isSaving}
            onClick={() => {
              if (!charge || !selectedShipmentId) return;
              setIsSaving(true);
              carrierReconciliationService
                .match(charge.id, selectedShipmentId)
                .then(() => {
                  toast.success(t("carrierReconciliation.match.saved"));
                  onOpenChange(false);
                  reset();
                  onMatched();
                })
                .catch((error: unknown) => {
                  toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
                })
                .finally(() => setIsSaving(false));
            }}
          >
            {t("common.save")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
