"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { storeOrdersService } from "@/services/store-orders-service";
import { createMasterDataService } from "@/services/master-data-service";
import { apiClient, ApiError } from "@/services/api-client";
import type { CurrencyRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { toISODate } from "@/lib/date";

interface LookupRow {
  id: string;
  name: string;
}

const paymentSourcesService = { list: () => apiClient.get<LookupRow[]>("/payment-sources") };
const receivingAccountsService = { list: () => apiClient.get<LookupRow[]>("/receiving-accounts") };
const currenciesService = createMasterDataService<CurrencyRow>("/currencies");

/**
 * Manual "Add Payment" (Part 4 of the four-gaps task) — creates a normal
 * `Payment` row via the EXISTING `POST /store-orders/:id/payments` endpoint
 * (the same one the optional first-payment-on-create path already uses),
 * then optionally attaches a note/receipt via the EXISTING generic Payment
 * notes/attachments endpoints. No parallel payment system, no bypassing
 * `paymentSourceId`/`receivingAccountId` — both are required exactly as the
 * existing `CreateStoreOrderPaymentDto` already requires.
 */
export function StoreOrderAddPaymentDialog({
  storeOrderId,
  orderCurrencyId,
  customerName,
  open,
  onOpenChange,
  onAdded,
}: {
  storeOrderId: string;
  orderCurrencyId: string;
  customerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const { t } = useLocale();
  const [paymentSources, setPaymentSources] = useState<LookupRow[]>([]);
  const [receivingAccounts, setReceivingAccounts] = useState<LookupRow[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);

  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(orderCurrencyId);
  const [paymentSourceId, setPaymentSourceId] = useState("");
  const [receivingAccountId, setReceivingAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(toISODate(new Date()));
  const [referenceNumber, setReferenceNumber] = useState("");
  const [senderName, setSenderName] = useState(customerName);
  const [notes, setNotes] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    paymentSourcesService
      .list()
      .then(setPaymentSources)
      .catch(() => setPaymentSources([]));
    receivingAccountsService
      .list()
      .then(setReceivingAccounts)
      .catch(() => setReceivingAccounts([]));
    currenciesService
      .list({ pageSize: 200 })
      .then((r) => setCurrencies(r.items))
      .catch(() => setCurrencies([]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount("");
    setCurrencyId(orderCurrencyId);
    setPaymentSourceId("");
    setReceivingAccountId("");
    setPaymentDate(toISODate(new Date()));
    setReferenceNumber("");
    setSenderName(customerName);
    setNotes("");
    setReceiptUrl("");
  }, [open, orderCurrencyId, customerName]);

  const amountValue = Number(amount);
  const isValid =
    amountValue > 0 &&
    Boolean(paymentSourceId) &&
    Boolean(receivingAccountId) &&
    Boolean(paymentDate) &&
    senderName.trim() !== "";

  const handleSave = async () => {
    if (!isValid) return;
    setIsSaving(true);
    try {
      const payment = await storeOrdersService.addPayment(storeOrderId, {
        paymentDate,
        amount: amountValue,
        currencyId: currencyId || undefined,
        paymentSourceId,
        receivingAccountId,
        referenceNumber: referenceNumber.trim() || undefined,
        senderName: senderName.trim(),
      });
      if (notes.trim()) {
        await apiClient.post(`/payments/${payment.id}/notes`, { text: notes.trim() });
      }
      if (receiptUrl.trim()) {
        await apiClient.post(`/payments/${payment.id}/attachments`, {
          fileUrl: receiptUrl.trim(),
        });
      }
      toast.success(t("storeOrders.detail.payments.added"));
      onOpenChange(false);
      onAdded();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to add payment.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-4" />
            {t("storeOrders.detail.payments.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("storeOrders.detail.payments.addDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>
              {t("storeOrders.detail.payments.amount")} <span className="text-destructive">*</span>
            </Label>
            <Input
              dir="ltr"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("storeOrders.detail.payments.currency")}</Label>
            <Select value={currencyId} onValueChange={setCurrencyId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((currency) => (
                  <SelectItem key={currency.id} value={currency.id}>
                    {currency.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              {t("storeOrders.detail.payments.method")} <span className="text-destructive">*</span>
            </Label>
            <Select value={paymentSourceId} onValueChange={setPaymentSourceId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("storeOrders.detail.payments.selectMethod")} />
              </SelectTrigger>
              <SelectContent>
                {paymentSources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              {t("storeOrders.detail.payments.receivingAccount")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Select value={receivingAccountId} onValueChange={setReceivingAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("storeOrders.detail.payments.selectAccount")} />
              </SelectTrigger>
              <SelectContent>
                {receivingAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              {t("storeOrders.detail.payments.date")} <span className="text-destructive">*</span>
            </Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("storeOrders.detail.payments.reference")}</Label>
            <Input
              dir="ltr"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </div>

          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>
              {t("storeOrders.detail.payments.sender")} <span className="text-destructive">*</span>
            </Label>
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </div>

          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>{t("storeOrders.detail.payments.notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>{t("storeOrders.detail.payments.receipt")}</Label>
            <Input
              dir="ltr"
              value={receiptUrl}
              onChange={(e) => setReceiptUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>

        <DialogFooter>
          <EnterpriseButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={handleSave} disabled={isSaving || !isValid}>
            {t("common.save")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
