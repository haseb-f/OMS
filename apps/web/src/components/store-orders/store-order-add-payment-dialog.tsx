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
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { storeOrdersService } from "@/services/store-orders-service";
import { apiClient, ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { useCurrencies, usePaymentMethods } from "@/hooks/use-reference-data";
import { toast } from "@/lib/toast";
import { toISODate } from "@/lib/date";

interface LookupRow {
  id: string;
  name: string;
}

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
  const [receivingAccounts, setReceivingAccounts] = useState<LookupRow[]>([]);
  const [context, setContext] = useState<{
    total: string;
    paid: string;
    outstanding: string;
  } | null>(null);
  const currencies = useCurrencies();
  const paymentMethods = usePaymentMethods();

  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(orderCurrencyId);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [receivingAccountId, setReceivingAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(toISODate(new Date()));
  const [referenceNumber, setReferenceNumber] = useState("");
  const [senderName, setSenderName] = useState(customerName);
  const [notes, setNotes] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    storeOrdersService
      .paymentContext(storeOrderId)
      .then((row) => {
        setContext(row);
        setAmount(row.outstanding);
      })
      .catch(() => setContext(null));
    receivingAccountsService
      .list()
      .then(setReceivingAccounts)
      .catch(() => setReceivingAccounts([]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrencyId(orderCurrencyId);
    setPaymentMethodId("");
    setReceivingAccountId("");
    setPaymentDate(toISODate(new Date()));
    setReferenceNumber("");
    setSenderName(customerName);
    setNotes("");
    setReceiptUrl("");
  }, [open, storeOrderId, orderCurrencyId, customerName]);

  const amountValue = Number(amount);
  const isValid =
    amountValue > 0 &&
    Boolean(paymentMethodId) &&
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
        paymentMethodId,
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

  const paymentMethodName =
    paymentMethods.find((method) => method.id === paymentMethodId)?.name ?? "—";
  const outstanding = Number(context?.outstanding ?? 0);
  const isOverpayment = amountValue > outstanding && outstanding >= 0;
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
        {context ? (
          <CreateOperationSummary
            title={t("storeOrders.detail.payments.amount")}
            rows={[
              { label: t("storeOrders.detail.payments.orderTotal"), value: context.total },
              { label: t("storeOrders.detail.payments.paid"), value: context.paid },
              { label: t("storeOrders.detail.payments.remaining"), value: context.outstanding },
            ]}
          />
        ) : null}
        {isOverpayment ? (
          <p className="text-caption text-warning-foreground">
            {t("storeOrders.detail.payments.overpaymentWarning")}
          </p>
        ) : null}
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
            <EntityCombobox
              value={currencies.find((currency) => currency.id === currencyId) ?? null}
              onChange={(row) => setCurrencyId(row?.id ?? orderCurrencyId)}
              items={currencies.filter((row) => !row.deletedAt)}
              getId={(item) => item.id}
              getTitle={(item) => `${item.code} — ${item.name}`}
              getSearchText={(item) => `${item.code} ${item.name}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              {t("storeOrders.detail.payments.method")} <span className="text-destructive">*</span>
            </Label>
            <EntityCombobox
              value={paymentMethods.find((method) => method.id === paymentMethodId) ?? null}
              onChange={(row) => setPaymentMethodId(row?.id ?? "")}
              items={paymentMethods}
              getId={(item) => item.id}
              getTitle={(item) => item.name}
              placeholder={t("storeOrders.detail.payments.selectMethod")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              {t("storeOrders.detail.payments.receivingAccount")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <EntityCombobox
              value={receivingAccounts.find((account) => account.id === receivingAccountId) ?? null}
              onChange={(row) => setReceivingAccountId(row?.id ?? "")}
              items={receivingAccounts}
              getId={(item) => item.id}
              getTitle={(item) => item.name}
              placeholder={t("storeOrders.detail.payments.selectAccount")}
            />
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
            { label: t("storeOrders.detail.payments.method"), value: paymentMethodName },
            { label: t("storeOrders.detail.payments.date"), value: paymentDate || "—" },
          ]}
        />
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}
