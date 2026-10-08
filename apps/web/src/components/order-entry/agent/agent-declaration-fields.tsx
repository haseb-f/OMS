"use client";

import { useId, useMemo } from "react";
import { FormSection, AmountStrip } from "@/components/documents/form-section";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { Field, FieldGrid } from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyValue } from "@/components/shared/money-value";
import { MoneyInput } from "@/components/shared/money-input";
import { FieldMessage, RequiredMark } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PaymentReceiptsField,
  type ReceiptUploadItem,
} from "@/components/business/payment-receipts-field";
import { declarationErrorField } from "@/components/payments/declaration/payment-declaration-fields";
import type {
  DeclarationError,
  DeclarationKind,
} from "@/components/payments/declaration/declaration-logic";
import {
  agentDeclarationAmount,
  type AgentDeclarationState,
} from "@/config/agent-portal/declaration";
import { OwnershipBadge } from "@/components/agent-portal/portal-badges";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import type { AgentEntryDestination } from "./agent-entry-source";

const KINDS: DeclarationKind[] = ["UNPAID", "FULL", "PARTIAL"];

/**
 * The payment the customer already made, declared with the order (spec 1.7,
 * `agent.payments.declare` for agent users): Unpaid / Paid in full (= the
 * payable total, read-only) / Partially paid, the agent's authorized
 * destination, the payment date, a reference and proof. The shared agent
 * declaration rules (`config/agent-portal/declaration`) decide what is valid; a
 * declaration is never a verification.
 */
export function AgentDeclarationFields({
  value,
  onChange,
  receipts,
  onReceiptsChange,
  destinations,
  total,
  currency,
  error,
  disabled,
  remaining,
  alreadyDeclared = 0,
  question,
}: {
  value: AgentDeclarationState;
  onChange: (next: AgentDeclarationState) => void;
  receipts: ReceiptUploadItem[];
  onReceiptsChange: (items: ReceiptUploadItem[]) => void;
  /** null while loading. */
  destinations: AgentEntryDestination[] | null;
  /** The payable total from the server's quote. */
  total: number;
  currency: string | { code: string } | null;
  error: DeclarationError | null;
  disabled?: boolean;
  /** Declaring on an existing order: what is still undeclared (the "paid in full" amount); default `total`. */
  remaining?: number;
  /** Declaring on an existing order: what earlier declarations already cover. */
  alreadyDeclared?: number;
  /** Section question (the order form and the declare dialog word it differently). */
  question?: string;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const paid = value.kind !== "UNPAID";
  const fullAmount = remaining ?? total;
  const set = (patch: Partial<AgentDeclarationState>) => onChange({ ...value, ...patch });
  const errorField = error ? declarationErrorField(error) : null;
  const fieldError = (name: string) =>
    errorField === name && error ? t(`agentPortal.declare.errors.${error}`) : null;
  const options = useMemo(
    () =>
      (destinations ?? []).map((destination) => ({
        value: destination.id,
        label: destination.label,
        description: [
          t(`agentPortal.status.ownership.${destination.ownership}`),
          destination.methodName,
          destination.details,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [destinations, t],
  );
  const selected = destinations?.find((destination) => destination.id === value.destinationId);

  return (
    <FormSection
      title={
        <span id={`${fieldId}-question`}>{question ?? t("orderEntry.agent.declarationTitle")}</span>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <SegmentedRadioGroup
          value={value.kind}
          onValueChange={(kind) => set({ kind })}
          disabled={disabled}
          aria-labelledby={`${fieldId}-question`}
          options={KINDS.map((kind) => ({
            value: kind,
            label: t(`agentPortal.declare.kinds.${kind}`),
          }))}
        />
        {paid ? (
          <p className="text-caption text-muted-foreground">
            {value.kind === "FULL"
              ? t("agentPortal.declare.fullHint")
              : t("agentPortal.declare.partialHint")}
          </p>
        ) : null}
      </div>

      {paid ? (
        <>
          <FieldGrid className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-2">
            <Field
              size="sm"
              data-field-name="declarationAmount"
              data-invalid={fieldError("declarationAmount") ? "true" : undefined}
            >
              <Label htmlFor={`${fieldId}-amount`}>
                {value.kind === "FULL"
                  ? t("agentPortal.declare.fullAmount")
                  : t("agentPortal.declare.amount")}
                {value.kind === "PARTIAL" ? <RequiredMark className="ms-0.5" /> : null}
              </Label>
              <MoneyInput
                id={`${fieldId}-amount`}
                value={value.kind === "FULL" ? String(fullAmount) : value.amount}
                readOnly={value.kind === "FULL"}
                disabled={disabled}
                aria-invalid={Boolean(fieldError("declarationAmount")) || undefined}
                onChange={(event) => set({ amount: event.target.value })}
              />
              <FieldMessage announce={false}>{fieldError("declarationAmount")}</FieldMessage>
            </Field>
            <Field
              size="md"
              data-field-name="declarationMethod"
              data-invalid={fieldError("declarationMethod") ? "true" : undefined}
            >
              <Label htmlFor={`${fieldId}-destination`}>
                {t("agentPortal.declare.destination")} <RequiredMark className="ms-0.5" />
              </Label>
              <SearchableSelect
                id={`${fieldId}-destination`}
                value={value.destinationId}
                onValueChange={(destinationId) => set({ destinationId })}
                options={options}
                loading={destinations === null}
                placeholder={t("agentPortal.declare.chooseDestination")}
                emptyText={t("orderEntry.agent.unavailableDestinations")}
                disabled={disabled}
                error={Boolean(fieldError("declarationMethod"))}
              />
              <FieldMessage announce={false}>{fieldError("declarationMethod")}</FieldMessage>
            </Field>
            <Field
              size="sm"
              data-field-name="declarationDate"
              data-invalid={fieldError("declarationDate") ? "true" : undefined}
            >
              <Label htmlFor={`${fieldId}-date`}>
                {t("agentPortal.declare.paymentDate")} <RequiredMark className="ms-0.5" />
              </Label>
              <EnterpriseDatePicker
                id={`${fieldId}-date`}
                value={fromISODate(value.paymentDate)}
                onChange={(date) => set({ paymentDate: date ? toISODate(date) : "" })}
                disabled={disabled}
                aria-invalid={Boolean(fieldError("declarationDate")) || undefined}
              />
              <FieldMessage announce={false}>{fieldError("declarationDate")}</FieldMessage>
            </Field>
            <Field size="md">
              <Label htmlFor={`${fieldId}-reference`}>{t("agentPortal.declare.reference")}</Label>
              <Input
                id={`${fieldId}-reference`}
                dir="ltr"
                value={value.reference}
                disabled={disabled}
                onChange={(event) => set({ reference: event.target.value })}
              />
            </Field>
          </FieldGrid>

          {selected ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-caption">
              <OwnershipBadge ownership={selected.ownership} />
              <span className="font-medium">{selected.label}</span>
              {selected.methodName ? (
                <span className="text-muted-foreground">{selected.methodName}</span>
              ) : null}
              {selected.details ? (
                <span className="min-w-0 break-words text-muted-foreground" dir="auto">
                  {selected.details}
                </span>
              ) : null}
            </div>
          ) : null}

          <PaymentReceiptsField items={receipts} onChange={onReceiptsChange} disabled={disabled} />
          <AmountStrip
            items={[
              {
                key: "total",
                label: t("agentPortal.declare.payable"),
                value: <MoneyValue value={total} currency={currency} />,
              },
              ...(alreadyDeclared > 0
                ? [
                    {
                      key: "declared",
                      label: t("agentPortal.declare.alreadyDeclared"),
                      value: <MoneyValue value={alreadyDeclared} currency={currency} />,
                    },
                  ]
                : []),
              {
                key: "will",
                label: t("agentPortal.declare.willDeclare"),
                value: (
                  <MoneyValue
                    value={agentDeclarationAmount(value, fullAmount)}
                    currency={currency}
                  />
                ),
                strong: true,
              },
            ]}
          />
        </>
      ) : null}
    </FormSection>
  );
}
