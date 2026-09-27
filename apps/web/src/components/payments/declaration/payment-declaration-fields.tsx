"use client";

import { useId, useMemo } from "react";
import { ModalSection } from "@/components/shared/modal-section";
import { CreateOperationTotals } from "@/components/shared/create-operation";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyValue } from "@/components/shared/money-value";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PaymentReceiptsField,
  type ReceiptUploadItem,
} from "@/components/business/payment-receipts-field";
import { usePaymentMethods } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import {
  declarationAmount,
  type DeclarationError,
  type DeclarationFormState,
  type DeclarationKind,
} from "./declaration-logic";

const KINDS: DeclarationKind[] = ["UNPAID", "FULL", "PARTIAL"];

/**
 * The one payment declaration form (Sales + Finance): order detail dialog,
 * order create and lead conversion all render this. It never offers an
 * accounting account and never asks for an amount on "Paid in full".
 */
export function PaymentDeclarationFields({
  value,
  onChange,
  receipts,
  onReceiptsChange,
  total,
  alreadyDeclared = 0,
  remaining,
  currency,
  error,
  disabled,
  title,
}: {
  value: DeclarationFormState;
  onChange: (next: DeclarationFormState) => void;
  receipts: ReceiptUploadItem[];
  onReceiptsChange: (items: ReceiptUploadItem[]) => void;
  total: number;
  alreadyDeclared?: number;
  remaining: number;
  currency?: { code: string } | string | null;
  error?: DeclarationError | null;
  disabled?: boolean;
  title?: string;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const paymentMethods = usePaymentMethods();
  const methodOptions = useMemo(
    () =>
      paymentMethods
        .filter((method) => method.isActive !== false || method.id === value.paymentMethodId)
        .map((method) => ({ value: method.id, label: method.name })),
    [paymentMethods, value.paymentMethodId],
  );
  const paid = value.kind !== "UNPAID";
  const set = (patch: Partial<DeclarationFormState>) => onChange({ ...value, ...patch });

  return (
    <ModalSection
      title={title ?? t("paymentDeclaration.dialog.question")}
      description={t("paymentDeclaration.dialog.notVerifiedNote")}
      columns={2}
    >
      <RadioGroup
        className="col-span-full grid-cols-1 sm:grid-cols-3"
        value={value.kind}
        onValueChange={(next) => set({ kind: next as DeclarationKind })}
        disabled={disabled}
        aria-label={t("paymentDeclaration.dialog.question")}
      >
        {KINDS.map((kind) => (
          <Label
            key={kind}
            htmlFor={`${fieldId}-${kind}`}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem id={`${fieldId}-${kind}`} value={kind} />
            {t(`paymentDeclaration.dialog.kinds.${kind}` as MessageKey)}
          </Label>
        ))}
      </RadioGroup>

      {paid ? (
        <>
          <p className="col-span-full text-caption text-muted-foreground">
            {value.kind === "FULL"
              ? t("paymentDeclaration.dialog.fullHint")
              : t("paymentDeclaration.dialog.partialHint")}
          </p>
          {value.kind === "PARTIAL" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-amount`}>
                {t("paymentDeclaration.dialog.amount")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`${fieldId}-amount`}
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                max={remaining}
                value={value.amount}
                disabled={disabled}
                aria-invalid={error === "amountRequired" || error === "amountExceeds"}
                onChange={(event) => set({ amount: event.target.value })}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-method`}>
              {t("paymentDeclaration.dialog.method")} <span className="text-destructive">*</span>
            </Label>
            <SearchableSelect
              id={`${fieldId}-method`}
              value={value.paymentMethodId}
              onValueChange={(next) => set({ paymentMethodId: next })}
              options={methodOptions}
              placeholder={t("paymentDeclaration.dialog.selectMethod")}
              emptyText={t("paymentDeclaration.dialog.noActiveMethods")}
              disabled={disabled}
              error={error === "methodRequired"}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-date`}>
              {t("paymentDeclaration.dialog.paymentDate")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <EnterpriseDatePicker
              id={`${fieldId}-date`}
              value={fromISODate(value.paymentDate)}
              onChange={(date) => set({ paymentDate: date ? toISODate(date) : "" })}
              disabled={disabled}
              aria-invalid={error === "dateRequired" || error === "dateFuture"}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-reference`}>
              {t("paymentDeclaration.dialog.reference")}
            </Label>
            <Input
              id={`${fieldId}-reference`}
              dir="ltr"
              value={value.referenceNumber}
              disabled={disabled}
              onChange={(event) => set({ referenceNumber: event.target.value })}
            />
          </div>
          <PaymentReceiptsField items={receipts} onChange={onReceiptsChange} disabled={disabled} />
          <div className="col-span-full">
            <CreateOperationTotals
              rows={[
                {
                  label: t("paymentDeclaration.dialog.orderTotal"),
                  value: <MoneyValue value={total} currency={currency} />,
                },
                ...(alreadyDeclared > 0
                  ? [
                      {
                        label: t("paymentDeclaration.dialog.alreadyDeclared"),
                        value: <MoneyValue value={alreadyDeclared} currency={currency} />,
                      },
                    ]
                  : []),
                {
                  label: t("paymentDeclaration.dialog.willDeclare"),
                  value: (
                    <MoneyValue value={declarationAmount(value, remaining)} currency={currency} />
                  ),
                  emphasis: "strong" as const,
                },
              ]}
            />
          </div>
        </>
      ) : null}
      {error ? (
        <p className="col-span-full text-caption text-destructive" role="alert">
          {t(`paymentDeclaration.dialog.errors.${error}` as MessageKey)}
        </p>
      ) : null}
    </ModalSection>
  );
}
