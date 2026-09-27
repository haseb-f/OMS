"use client";

import { useId, useState } from "react";
import { PlusCircle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { fromISODate, toISODate } from "@/lib/date";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { paymentReconciliationService } from "@/services/payment-reconciliation-service";

type TextField =
  "providerReference" | "customerName" | "customerPhone" | "orderReference" | "providerStatus";
const TEXT_FIELDS: TextField[] = [
  "providerReference",
  "orderReference",
  "customerName",
  "customerPhone",
  "providerStatus",
];
const LTR_FIELDS = new Set<TextField>(["providerReference", "orderReference", "customerPhone"]);

function toAmount(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : Number.NaN;
}

/** Manual statement transaction (Finance, import permission) — same validation + dedupe as files and sheets. */
export function ManualLineDialog({
  methodId,
  open,
  onOpenChange,
  onSaved,
}: {
  methodId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const idPrefix = useId();
  const [text, setText] = useState<Record<TextField, string>>({
    providerReference: "",
    customerName: "",
    customerPhone: "",
    orderReference: "",
    providerStatus: "",
  });
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [net, setNet] = useState("");
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(toISODate(new Date()));
  const [busy, setBusy] = useState(false);

  const amountValue = toAmount(amount);
  const valid = !!currencyId && !!date && amountValue !== undefined && amountValue > 0;

  const reset = () => {
    setText({
      providerReference: "",
      customerName: "",
      customerPhone: "",
      orderReference: "",
      providerStatus: "",
    });
    setAmount("");
    setFee("");
    setNet("");
  };

  const save = async () => {
    if (!valid || !currencyId) return;
    setBusy(true);
    try {
      const optional = (value: string) => value.trim() || undefined;
      await paymentReconciliationService.createManualLine(methodId, {
        providerReference: optional(text.providerReference),
        customerName: optional(text.customerName),
        customerPhone: optional(text.customerPhone),
        orderReference: optional(text.orderReference),
        providerStatus: optional(text.providerStatus),
        amount: amountValue as number,
        currencyId,
        transactionDate: date,
        feeAmount: toAmount(fee),
        netAmount: toAmount(net),
      });
      toast.success(t("paymentReconciliation.manual.saved"));
      reset();
      onOpenChange(false);
      onSaved();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={PlusCircle}
      title={t("paymentReconciliation.manual.title")}
      description={t("paymentReconciliation.manual.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="ghost" onClick={requestClose} disabled={busy}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={() => void save()}
            disabled={busy || !valid}
            isLoading={busy}
          >
            {t("paymentReconciliation.manual.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-amount`}>{t("paymentReconciliation.fields.amount")} *</Label>
          <Input
            id={`${idPrefix}-amount`}
            dir="ltr"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-currency`}>
            {t("paymentReconciliation.fields.currency")} *
          </Label>
          <CurrencyPicker
            id={`${idPrefix}-currency`}
            valueKey="id"
            value={currencyId}
            onValueChange={(value) => setCurrencyId(value || null)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-date`}>
            {t("paymentReconciliation.fields.transactionDate")} *
          </Label>
          <EnterpriseDatePicker
            id={`${idPrefix}-date`}
            value={fromISODate(date)}
            onChange={(value) => setDate(value ? toISODate(value) : "")}
          />
        </div>
        {TEXT_FIELDS.map((field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-${field}`}>
              {t(`paymentReconciliation.fields.${field}` as MessageKey)}
            </Label>
            <Input
              id={`${idPrefix}-${field}`}
              dir={LTR_FIELDS.has(field) ? "ltr" : "auto"}
              value={text[field]}
              onChange={(event) =>
                setText((current) => ({ ...current, [field]: event.target.value }))
              }
            />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-fee`}>{t("paymentReconciliation.fields.fee")}</Label>
          <Input
            id={`${idPrefix}-fee`}
            dir="ltr"
            inputMode="decimal"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-net`}>{t("paymentReconciliation.fields.net")}</Label>
          <Input
            id={`${idPrefix}-net`}
            dir="ltr"
            inputMode="decimal"
            value={net}
            onChange={(event) => setNet(event.target.value)}
          />
        </div>
      </div>
    </EnterpriseModal>
  );
}
