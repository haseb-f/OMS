"use client";

import { useId, useMemo } from "react";
import { FormSection, AmountStrip } from "@/components/documents/form-section";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import type { FormErrorItem } from "@/components/shared/form-error-summary";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyValue } from "@/components/shared/money-value";
import { FieldMessage } from "@/components/ui/form";
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

/** The field a declaration error belongs under (`data-field-name`), or null for a form-level one. */
export function declarationErrorField(error: DeclarationError): string | null {
  switch (error) {
    case "amountRequired":
    case "amountExceeds":
      return "declarationAmount";
    case "methodRequired":
      return "declarationMethod";
    case "dateRequired":
    case "dateFuture":
      return "declarationDate";
    default:
      return null;
  }
}

/** `FormErrorSummary` item for a declaration error — links to its field when it has one. */
export function declarationErrorItem(
  error: DeclarationError,
  t: (key: MessageKey) => string,
): FormErrorItem {
  const field = declarationErrorField(error);
  const labelKey: Record<string, MessageKey> = {
    declarationAmount: "paymentDeclaration.dialog.amount",
    declarationMethod: "paymentDeclaration.dialog.method",
    declarationDate: "paymentDeclaration.dialog.paymentDate",
  };
  return {
    fieldId: field ?? undefined,
    label: field ? t(labelKey[field]) : undefined,
    message: t(`paymentDeclaration.dialog.errors.${error}` as MessageKey),
  };
}

/**
 * The one payment declaration form (Sales + Finance): order detail dialog,
 * order create and lead conversion all render this. It never offers an
 * accounting account and never asks for an amount on "Paid in full".
 *
 * Layout: a heading + hairline section inside the host dialog (no card),
 * the question as a compact segmented control (each segment is a real
 * `role="radio"`), then method · date · reference in one row on desktop,
 * the receipt drop, and a compact figures strip. Errors sit under their
 * field; the host dialog lists them in its `FormErrorSummary`.
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
  const errorField = error ? declarationErrorField(error) : null;
  const errorText = error ? t(`paymentDeclaration.dialog.errors.${error}` as MessageKey) : null;
  const fieldError = (name: string) => (errorField === name ? errorText : null);

  return (
    <FormSection
      title={
        <span id={`${fieldId}-question`}>{title ?? t("paymentDeclaration.dialog.question")}</span>
      }
      description={t("paymentDeclaration.dialog.notVerifiedNote")}
    >
      <SegmentedRadioGroup
        value={value.kind}
        onValueChange={(kind) => set({ kind })}
        disabled={disabled}
        aria-labelledby={`${fieldId}-question`}
        options={KINDS.map((kind) => ({
          value: kind,
          label: t(`paymentDeclaration.dialog.kinds.${kind}` as MessageKey),
        }))}
      />

      {paid ? (
        <>
          <p className="text-caption text-muted-foreground">
            {value.kind === "FULL"
              ? t("paymentDeclaration.dialog.fullHint")
              : t("paymentDeclaration.dialog.partialHint")}
          </p>
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-2 @3xl:grid-cols-3">
            {value.kind === "PARTIAL" ? (
              <div
                data-field-name="declarationAmount"
                data-invalid={fieldError("declarationAmount") ? "true" : undefined}
                className="flex min-w-0 flex-col gap-1"
              >
                <Label htmlFor={`${fieldId}-amount`}>
                  {t("paymentDeclaration.dialog.amount")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`${fieldId}-amount`}
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  max={remaining}
                  inputMode="decimal"
                  className="text-end tabular-nums"
                  value={value.amount}
                  disabled={disabled}
                  aria-invalid={Boolean(fieldError("declarationAmount")) || undefined}
                  onChange={(event) => set({ amount: event.target.value })}
                />
                <FieldMessage announce={false}>{fieldError("declarationAmount")}</FieldMessage>
              </div>
            ) : null}
            <div
              data-field-name="declarationMethod"
              data-invalid={fieldError("declarationMethod") ? "true" : undefined}
              className="flex min-w-0 flex-col gap-1"
            >
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
                error={Boolean(fieldError("declarationMethod"))}
              />
              <FieldMessage announce={false}>{fieldError("declarationMethod")}</FieldMessage>
            </div>
            <div
              data-field-name="declarationDate"
              data-invalid={fieldError("declarationDate") ? "true" : undefined}
              className="flex min-w-0 flex-col gap-1"
            >
              <Label htmlFor={`${fieldId}-date`}>
                {t("paymentDeclaration.dialog.paymentDate")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <EnterpriseDatePicker
                id={`${fieldId}-date`}
                value={fromISODate(value.paymentDate)}
                onChange={(date) => set({ paymentDate: date ? toISODate(date) : "" })}
                disabled={disabled}
                aria-invalid={Boolean(fieldError("declarationDate")) || undefined}
              />
              <FieldMessage announce={false}>{fieldError("declarationDate")}</FieldMessage>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
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
          </div>
          <PaymentReceiptsField items={receipts} onChange={onReceiptsChange} disabled={disabled} />
          <AmountStrip
            items={[
              {
                key: "total",
                label: t("paymentDeclaration.dialog.orderTotal"),
                value: <MoneyValue value={total} currency={currency} />,
              },
              ...(alreadyDeclared > 0
                ? [
                    {
                      key: "declared",
                      label: t("paymentDeclaration.dialog.alreadyDeclared"),
                      value: <MoneyValue value={alreadyDeclared} currency={currency} />,
                    },
                  ]
                : []),
              {
                key: "willDeclare",
                label: t("paymentDeclaration.dialog.willDeclare"),
                value: (
                  <MoneyValue value={declarationAmount(value, remaining)} currency={currency} />
                ),
                strong: true,
              },
            ]}
          />
        </>
      ) : null}
      {error && !errorField ? <FieldMessage announce={false}>{errorText}</FieldMessage> : null}
    </FormSection>
  );
}
