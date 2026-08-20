"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import { ModalSection } from "@/components/shared/modal-section";
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
import { apiClient, ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { useCurrencies } from "@/hooks/use-reference-data";
import { toast } from "@/lib/toast";
import { toISODate } from "@/lib/date";

interface LookupRow {
  id: string;
  name: string;
}

const paymentSourcesService = { list: () => apiClient.get<LookupRow[]>("/payment-sources") };
const receivingAccountsService = { list: () => apiClient.get<LookupRow[]>("/receiving-accounts") };

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
  const currencies = useCurrencies();

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

  const paymentSourceName =
    paymentSources.find((source) => source.id === paymentSourceId)?.name ?? "—";
  const currencyCode = currencies.find((currency) => currency.id === currencyId)?.code ?? "";

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={Wallet}
      title={t("storeOrders.detail.payments.addTitle")}
      description={t("storeOrders.detail.payments.addDescription")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
          submitDisabled={!isValid}
        />
      )}
    >
      <CreateOperationLayout>
        <ModalSection title={t("storeOrders.createDialog.sections.payment")} columns={2}>
          <div className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-1">
            <Label>
              {t("storeOrders.detail.payments.date")} <span className="text-destructive">*</span>
            </Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("storeOrders.detail.payments.reference")}</Label>
            <Input
              dir="ltr"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </div>
          <div className="col-span-full flex flex-col gap-1">
            <Label>
              {t("storeOrders.detail.payments.sender")} <span className="text-destructive">*</span>
            </Label>
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </div>
          <div className="col-span-full flex flex-col gap-1">
            <Label>{t("storeOrders.detail.payments.notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="col-span-full flex flex-col gap-1">
            <Label>{t("storeOrders.detail.payments.receipt")}</Label>
            <Input
              dir="ltr"
              value={receiptUrl}
              onChange={(e) => setReceiptUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </ModalSection>
        <CreateOperationSummary
          title={t("common.summary")}
          rows={[
            { label: t("storeOrders.fields.customer"), value: customerName || "—" },
            {
              label: t("storeOrders.detail.payments.amount"),
              value: (
                <span dir="ltr">
                  {amountValue > 0 ? `${amountValue} ${currencyCode}`.trim() : "—"}
                </span>
              ),
            },
            { label: t("storeOrders.detail.payments.method"), value: paymentSourceName },
            { label: t("storeOrders.detail.payments.date"), value: paymentDate || "—" },
          ]}
        />
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}
