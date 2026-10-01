"use client";

import { useId, useMemo, useState } from "react";
import { AlertTriangle, Info, Plus, RefreshCw, Trash2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/shared/searchable-select";
import { MoneyInput } from "@/components/shared/money-input";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { PartnerPicker } from "@/components/business/partner-picker";
import { EnterpriseButton } from "@/components/ui/button";
import { SubmitButton } from "@/components/shared/form-fields/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FieldMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  buildAmendmentChanges,
  initialAmendDraft,
  isAmendReasonValid,
  type AmendDraft,
  type AmendDraftLine,
  type AmendableOrder,
} from "@/config/store-orders/amendment-draft";
import { buildImpactView } from "@/config/store-orders/amendment-impacts";
import type {
  AmendmentCommitResult,
  AmendmentPreview,
  OrderAmendmentsClient,
  VersionConflictDetails,
} from "@/services/order-amendments-service";
import { ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import { reportApiError, reportSuccess } from "@/lib/toast";

export interface AmendDialogOptions {
  /** Server-side product search (company catalog / the agent's own products). */
  searchProducts: (query: string) => Promise<SearchableSelectOption[]>;
  countries: SearchableSelectOption[];
  /** Company orders only (agent orders use the agreement currency). */
  currencies?: SearchableSelectOption[];
  /** Company order: switch to another existing customer. */
  canSwitchCustomer: boolean;
  /** Company order: correct the customer master (`partners.edit`); agent orders always may. */
  canCorrectIdentity: boolean;
}

let lineSeq = 0;
const newLineKey = () => `new-${++lineSeq}`;

/**
 * Round 5 Spec 1A — the guided "Amend order" dialog, shared by the internal
 * order detail and the agent portal (the `client` decides which API). Step 1
 * edits the sections (customer, items, currency & payment, fulfillment &
 * destination) and a required reason; step 2 previews the impacts —
 * blocking reasons with the required prior step, acknowledgements as
 * checkboxes — and commits against the previewed version.
 */
export function OrderAmendDialog<TOrder>({
  order,
  client,
  options,
  open,
  onOpenChange,
  onAmended,
  onReload,
}: {
  order: AmendableOrder;
  client: OrderAmendmentsClient<TOrder>;
  options: AmendDialogOptions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAmended: (result: AmendmentCommitResult<TOrder>) => void;
  /** Reloads the order after a version conflict. */
  onReload: () => void;
}) {
  if (!open) return null;
  return (
    <AmendDialogBody
      order={order}
      client={client}
      options={options}
      onOpenChange={onOpenChange}
      onAmended={onAmended}
      onReload={onReload}
    />
  );
}

function AmendDialogBody<TOrder>({
  order,
  client,
  options,
  onOpenChange,
  onAmended,
  onReload,
}: {
  order: AmendableOrder;
  client: OrderAmendmentsClient<TOrder>;
  options: AmendDialogOptions;
  onOpenChange: (open: boolean) => void;
  onAmended: (result: AmendmentCommitResult<TOrder>) => void;
  onReload: () => void;
}) {
  const { t, locale } = useLocale();
  const fieldId = useId();
  const [draft, setDraft] = useState<AmendDraft>(() => initialAmendDraft(order));
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [showErrors, setShowErrors] = useState(false);
  const [preview, setPreview] = useState<AmendmentPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflictDetails | null>(null);

  const diff = useMemo(() => buildAmendmentChanges(order, draft), [order, draft]);
  const reasonValid = isAmendReasonValid(draft.reason);
  const view = preview ? buildImpactView(preview, acknowledged, t, locale) : null;
  const patch = (next: Partial<AmendDraft>) => setDraft((prev) => ({ ...prev, ...next }));
  const patchLine = (key: string, next: Partial<AmendDraftLine>) =>
    patch({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...next } : line)) });
  const isCompany = !order.isAgentOrder;
  const amountsOptional = order.isAgentOrder && draft.pricingMode === "SHIPPING_INCLUDED";

  const runPreview = async () => {
    setShowErrors(true);
    if (diff.error || !diff.hasChanges || !reasonValid) return;
    setBusy(true);
    try {
      const result = await client.preview(order.id, diff.changes);
      setPreview(result);
      setAcknowledged(new Set());
      setStep("preview");
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview || !view?.canCommit) return;
    setBusy(true);
    try {
      const result = await client.commit(order.id, {
        changes: diff.changes,
        expectedVersion: preview.version,
        reason: draft.reason.trim(),
        acknowledgements: [...acknowledged],
        impactsFingerprint: preview.impactsFingerprint,
      });
      reportSuccess(t("orderAmendments.success", { version: result.version }), {
        description: result.invoiceRegeneration
          ? result.invoiceRegeneration.regenerated
            ? t("orderAmendments.invoiceRegenerated", {
                number: result.invoiceRegeneration.invoiceNumber ?? "",
              })
            : result.invoiceRegeneration.message
          : undefined,
      });
      onAmended(result);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === ("ORDER_VERSION_CONFLICT" as string)) {
        setConflict((error.details as unknown as VersionConflictDetails) ?? null);
        return;
      }
      // A blocking reason or a missing confirmation appeared since the
      // preview: show the fresh impact list instead of a bare toast.
      const impacts = (error instanceof ApiError &&
        (error.details as { impacts?: AmendmentPreview["impacts"] } | undefined)?.impacts) as
        AmendmentPreview["impacts"] | undefined;
      if (impacts && preview) {
        // Fresh impacts → fresh confirmations; the next commit re-previews.
        setAcknowledged(new Set());
        try {
          setPreview(await client.preview(order.id, diff.changes));
        } catch {
          setPreview({
            ...preview,
            impacts,
            canCommit: !impacts.some((i) => i.severity === "BLOCKING"),
          });
        }
      }
      reportApiError(error, "common.failedToSave");
    } finally {
      setBusy(false);
    }
  };

  const footer = (requestClose: () => void) =>
    step === "edit" ? (
      <>
        <EnterpriseButton type="button" variant="outline" size="sm" onClick={requestClose}>
          {t("common.cancel")}
        </EnterpriseButton>
        <SubmitButton
          type="button"
          size="sm"
          isSubmitting={busy}
          onClick={() => void runPreview()}
          disabled={busy}
        >
          {busy ? t("orderAmendments.previewing") : t("orderAmendments.review")}
        </SubmitButton>
      </>
    ) : (
      <>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setStep("edit");
            setConflict(null);
          }}
        >
          {t("orderAmendments.back")}
        </EnterpriseButton>
        <SubmitButton
          type="button"
          size="sm"
          isSubmitting={busy}
          disabled={busy || !view?.canCommit || conflict != null}
          onClick={() => void commit()}
        >
          {busy ? t("orderAmendments.saving") : t("orderAmendments.commit")}
        </SubmitButton>
      </>
    );

  const editError = showErrors
    ? (diff.error ??
      (!diff.hasChanges ? "orderAmendments.noChanges" : null) ??
      (!reasonValid ? "orderAmendments.fields.reasonRequired" : null))
    : null;

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={t("orderAmendments.title", { number: order.number })}
      description={
        step === "edit" ? t("orderAmendments.description") : t("orderAmendments.steps.preview")
      }
      isDirty={diff.hasChanges || draft.reason.trim().length > 0}
      footer={footer}
      testId="order-amend-dialog"
    >
      {step === "edit" ? (
        <FormCardStack>
          <FormCardSection title={t("orderAmendments.sections.customer")}>
            {isCompany && options.canSwitchCustomer ? (
              <FormCardField
                label={t("orderAmendments.fields.switchCustomer")}
                message={
                  <p className="text-caption text-muted-foreground">
                    {t("orderAmendments.fields.switchCustomerHint")}
                  </p>
                }
              >
                <PartnerPicker
                  role="CUSTOMER"
                  value={
                    draft.partnerId
                      ? ({ id: draft.partnerId, name: draft.partnerName } as never)
                      : null
                  }
                  onChange={(partner) =>
                    patch({
                      partnerId: partner.id,
                      partnerName: partner.name,
                      name: partner.name,
                      phone: partner.phone ?? partner.mobile ?? "",
                      email: partner.email ?? "",
                      countryId: partner.countryId ?? "",
                      city: partner.city ?? "",
                      address: partner.address ?? "",
                    })
                  }
                />
              </FormCardField>
            ) : null}
            <FormCardRow>
              <FormCardField
                size="md"
                label={t("orderAmendments.fields.name")}
                htmlFor={`${fieldId}-name`}
              >
                <Input
                  id={`${fieldId}-name`}
                  value={draft.name}
                  disabled={!options.canCorrectIdentity}
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </FormCardField>
              <FormCardField
                size="sm"
                label={t("orderAmendments.fields.phone")}
                htmlFor={`${fieldId}-phone`}
              >
                <Input
                  id={`${fieldId}-phone`}
                  dir="ltr"
                  inputMode="tel"
                  value={draft.phone}
                  disabled={!options.canCorrectIdentity}
                  onChange={(event) => patch({ phone: event.target.value })}
                />
              </FormCardField>
              {isCompany ? (
                <FormCardField
                  size="md"
                  label={t("orderAmendments.fields.email")}
                  htmlFor={`${fieldId}-email`}
                >
                  <Input
                    id={`${fieldId}-email`}
                    dir="ltr"
                    type="email"
                    value={draft.email}
                    disabled={!options.canCorrectIdentity}
                    onChange={(event) => patch({ email: event.target.value })}
                  />
                </FormCardField>
              ) : null}
            </FormCardRow>
            {isCompany ? (
              <p className="text-caption text-muted-foreground">
                {options.canCorrectIdentity
                  ? t("orderAmendments.fields.identityHint")
                  : t("orderAmendments.fields.identityLocked")}
              </p>
            ) : null}
          </FormCardSection>

          <FormCardSection
            title={t("orderAmendments.sections.items")}
            actions={
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch({
                    lines: [
                      ...draft.lines,
                      {
                        key: newLineKey(),
                        itemId: null,
                        productId: "",
                        productName: "",
                        quantity: "1",
                        agreedAmount: "",
                      },
                    ],
                  })
                }
              >
                <Plus />
                {t("orderAmendments.fields.addLine")}
              </EnterpriseButton>
            }
          >
            <ul className="flex flex-col gap-2">
              {draft.lines.map((line) => (
                <li
                  key={line.key}
                  data-testid="amend-line"
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_auto]"
                >
                  <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
                    <Label className="sm:sr-only">{t("orderAmendments.fields.product")}</Label>
                    <EntityCombobox<SearchableSelectOption>
                      id={`${fieldId}-product-${line.key}`}
                      value={
                        line.productId ? { value: line.productId, label: line.productName } : null
                      }
                      onSearch={options.searchProducts}
                      getId={(option) => option.value}
                      getTitle={(option) => option.label}
                      getSubtitle={(option) => option.description}
                      placeholder={t("orderAmendments.fields.product")}
                      triggerProps={{ "aria-label": t("orderAmendments.fields.product") }}
                      onChange={(option) =>
                        patchLine(line.key, {
                          productId: option?.value ?? "",
                          productName: option?.label ?? "",
                        })
                      }
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label className="sm:sr-only">{t("orderAmendments.fields.quantity")}</Label>
                    <Input
                      aria-label={t("orderAmendments.fields.quantity")}
                      dir="ltr"
                      inputMode="numeric"
                      className="num"
                      value={line.quantity}
                      onChange={(event) => patchLine(line.key, { quantity: event.target.value })}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label className="sm:sr-only">{t("orderAmendments.fields.agreedAmount")}</Label>
                    <MoneyInput
                      aria-label={t("orderAmendments.fields.agreedAmount")}
                      value={line.agreedAmount}
                      placeholder={amountsOptional ? "—" : undefined}
                      onChange={(event) =>
                        patchLine(line.key, { agreedAmount: event.target.value })
                      }
                    />
                  </div>
                  <IconActionButton
                    label={t("orderAmendments.fields.removeLine")}
                    disabled={draft.lines.length <= 1}
                    onClick={() =>
                      patch({ lines: draft.lines.filter((entry) => entry.key !== line.key) })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </IconActionButton>
                </li>
              ))}
            </ul>
          </FormCardSection>

          <FormCardSection title={t("orderAmendments.sections.payment")}>
            <FormCardRow>
              {isCompany && options.currencies ? (
                <FormCardField size="sm" label={t("orderAmendments.fields.currency")}>
                  <SearchableSelect
                    aria-label={t("orderAmendments.fields.currency")}
                    value={draft.currencyId}
                    options={options.currencies}
                    onValueChange={(value) => patch({ currencyId: value })}
                  />
                </FormCardField>
              ) : null}
              <FormCardField size="md" label={t("orderAmendments.fields.paymentType")}>
                <SegmentedRadioGroup
                  aria-label={t("orderAmendments.fields.paymentType")}
                  value={draft.paymentType}
                  onValueChange={(value) => patch({ paymentType: value })}
                  options={[
                    { value: "PREPAID", label: t("storeOrders.paymentType.PREPAID") },
                    {
                      value: "CASH_ON_DELIVERY",
                      label: t("storeOrders.paymentType.CASH_ON_DELIVERY"),
                    },
                  ]}
                />
              </FormCardField>
            </FormCardRow>
            {order.isAgentOrder ? (
              <FormCardRow>
                <FormCardField size="md" label={t("orderAmendments.fields.pricingMode")}>
                  <SegmentedRadioGroup
                    aria-label={t("orderAmendments.fields.pricingMode")}
                    value={draft.pricingMode}
                    onValueChange={(value) => patch({ pricingMode: value })}
                    options={[
                      {
                        value: "SHIPPING_ADDED",
                        label: t("agents.storeOrder.mode.SHIPPING_ADDED"),
                      },
                      {
                        value: "SHIPPING_INCLUDED",
                        label: t("agents.storeOrder.mode.SHIPPING_INCLUDED"),
                      },
                    ]}
                  />
                </FormCardField>
                {draft.pricingMode === "SHIPPING_INCLUDED" ? (
                  <FormCardField
                    size="sm"
                    label={t("orderAmendments.fields.agreedTotal")}
                    htmlFor={`${fieldId}-total`}
                  >
                    <MoneyInput
                      id={`${fieldId}-total`}
                      value={draft.agreedTotal}
                      onChange={(event) => patch({ agreedTotal: event.target.value })}
                    />
                  </FormCardField>
                ) : null}
              </FormCardRow>
            ) : null}
            {order.isAgentOrder ? (
              <p className="text-caption text-muted-foreground">
                {t("orderAmendments.fields.currencyAgentHint")}
              </p>
            ) : null}
          </FormCardSection>

          <FormCardSection title={t("orderAmendments.sections.fulfillment")}>
            <FormCardField label={t("orderAmendments.fields.fulfillmentMethod")}>
              <SegmentedRadioGroup
                aria-label={t("orderAmendments.fields.fulfillmentMethod")}
                value={draft.fulfillmentMethod}
                onValueChange={(value) => patch({ fulfillmentMethod: value })}
                options={[
                  { value: "SHIPPING", label: t("storeOrders.fulfillmentMethod.SHIPPING") },
                  { value: "PICKUP", label: t("storeOrders.fulfillmentMethod.PICKUP") },
                ]}
              />
            </FormCardField>
            <FormCardRow>
              <FormCardField size="sm" label={t("orderAmendments.fields.country")}>
                <SearchableSelect
                  aria-label={t("orderAmendments.fields.country")}
                  value={draft.countryId}
                  options={options.countries}
                  allowClear
                  onValueChange={(value) => patch({ countryId: value })}
                />
              </FormCardField>
              <FormCardField
                size="sm"
                label={t("orderAmendments.fields.city")}
                htmlFor={`${fieldId}-city`}
              >
                <Input
                  id={`${fieldId}-city`}
                  value={draft.city}
                  onChange={(event) => patch({ city: event.target.value })}
                />
              </FormCardField>
              <FormCardField
                size="lg"
                label={t("orderAmendments.fields.address")}
                htmlFor={`${fieldId}-address`}
              >
                <Input
                  id={`${fieldId}-address`}
                  value={draft.address}
                  onChange={(event) => patch({ address: event.target.value })}
                />
              </FormCardField>
            </FormCardRow>
          </FormCardSection>

          <FormCardSection title={t("orderAmendments.sections.reason")}>
            <FormCardField
              label={t("orderAmendments.fields.reason")}
              htmlFor={`${fieldId}-reason`}
              required
            >
              <Textarea
                id={`${fieldId}-reason`}
                rows={2}
                value={draft.reason}
                placeholder={t("orderAmendments.fields.reasonPlaceholder")}
                aria-invalid={showErrors && !reasonValid ? true : undefined}
                onChange={(event) => patch({ reason: event.target.value })}
              />
            </FormCardField>
            {editError ? <FieldMessage>{t(editError)}</FieldMessage> : null}
          </FormCardSection>
        </FormCardStack>
      ) : preview && view ? (
        <FormCardStack>
          {conflict ? (
            <Alert tone="warning">
              <RefreshCw />
              <div className="flex min-w-0 flex-col gap-2">
                <AlertTitle>{t("orderAmendments.conflict.title")}</AlertTitle>
                <AlertDescription>
                  {t("orderAmendments.conflict.description", {
                    user: conflict.changedBy ?? t("orderAmendments.conflict.someone"),
                    time: formatDateTime(conflict.changedAt),
                  })}
                </AlertDescription>
                <EnterpriseButton
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={() => {
                    onReload();
                    onOpenChange(false);
                  }}
                >
                  {t("orderAmendments.conflict.reload")}
                </EnterpriseButton>
              </div>
            </Alert>
          ) : null}
          <p className="text-body font-medium">
            {preview.totals.previous === preview.totals.next &&
            preview.totals.previousCurrency === preview.totals.currency
              ? t("orderAmendments.totalsUnchanged", {
                  next: `${preview.totals.next} ${preview.totals.currency}`,
                })
              : t("orderAmendments.totals", {
                  previous: `${preview.totals.previous} ${preview.totals.previousCurrency}`,
                  next: `${preview.totals.next} ${preview.totals.currency}`,
                })}
          </p>
          {view.blocking.length > 0 ? (
            <Alert tone="destructive" data-testid="amend-blocking">
              <AlertTriangle />
              <div className="flex min-w-0 flex-col gap-1">
                <AlertTitle>{t("orderAmendments.blockingTitle")}</AlertTitle>
                <ul className="flex list-disc flex-col gap-1 ps-4">
                  {view.blocking.map((item, index) => (
                    <li key={`${item.code}-${index}`}>{item.text}</li>
                  ))}
                </ul>
              </div>
            </Alert>
          ) : null}
          {view.acknowledgements.length > 0 ? (
            <FormCardSection
              title={t("orderAmendments.acknowledgeTitle")}
              description={t("orderAmendments.acknowledgeHint")}
            >
              <ul className="flex flex-col gap-2">
                {view.acknowledgements.map((item) => (
                  <li key={item.code} className="flex items-start gap-2">
                    <Checkbox
                      id={`${fieldId}-ack-${item.code}`}
                      checked={item.checked}
                      onCheckedChange={(checked) =>
                        setAcknowledged((prev) => {
                          const next = new Set(prev);
                          if (checked === true) next.add(item.code);
                          else next.delete(item.code);
                          return next;
                        })
                      }
                    />
                    <Label
                      htmlFor={`${fieldId}-ack-${item.code}`}
                      className="text-body font-normal leading-snug"
                    >
                      {item.text}
                    </Label>
                  </li>
                ))}
              </ul>
            </FormCardSection>
          ) : null}
          {view.info.length > 0 ? (
            <FormCardSection title={t("orderAmendments.infoTitle")}>
              <ul className="flex flex-col gap-1">
                {view.info.map((item, index) => (
                  <li
                    key={`${item.code}-${index}`}
                    className="flex items-start gap-2 text-caption text-muted-foreground"
                  >
                    <Info className="mt-px size-3.5 shrink-0" />
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </FormCardSection>
          ) : null}
        </FormCardStack>
      ) : null}
    </EnterpriseModal>
  );
}
