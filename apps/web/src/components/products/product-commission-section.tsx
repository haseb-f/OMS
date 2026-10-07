"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWatch } from "react-hook-form";
import { Form, RequiredMark } from "@/components/ui/form";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { ModalSection, ModalFieldFullWidth } from "@/components/shared/modal-section";
import { DetailField, DetailFieldGrid } from "@/components/shared/detail-workspace";
import { SemanticValue } from "@/components/shared/semantic-value";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import {
  DateFormField,
  NumberFormField,
  SelectFormField,
  TextFormField,
  useZodForm,
} from "@/components/shared/form-fields";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { formatNumber } from "@/lib/format-number";
import {
  productCommissionService,
  type ProductCommissionHistoryRow,
  type ProductCommissionSetting,
} from "@/services/product-commission-service";
import {
  commissionDraftInvalid,
  createProductCommissionSchema,
  toProductCommissionInput,
  type ProductCommissionDraft,
  type ProductCommissionFormValues,
} from "./product-commission-form";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldMessage } from "@/components/ui/form";

const formatRate = (rate: number) => `${formatNumber(rate, { maxDecimals: 4 })}%`;

function defaultValues(setting: ProductCommissionSetting | null): ProductCommissionFormValues {
  return {
    source: setting?.source ?? "INHERIT",
    ratePercent: setting?.overrideRatePercent ?? undefined,
    effectiveFrom: toISODate(new Date()),
    reason: "",
  };
}

/**
 * Item commission setting of an EXISTING agent-owned product
 * (commission-policy.md A4): ownership, class, current source/rate, a
 * change form (effective-dated; 0% is an explicit rate) and the override
 * history. Viewing needs `agents.view`; changing needs
 * `agents.agreements.manage` — the same permissions the API enforces.
 */
export function ProductCommissionSection({ productId }: { productId: string }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canView = hasPermission("agents.view");
  const canEdit = hasPermission("agents.agreements.manage");

  const [setting, setSetting] = useState<ProductCommissionSetting | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const schema = useMemo(() => createProductCommissionSchema(t), [t]);
  const form = useZodForm<ProductCommissionFormValues>(schema, {
    defaultValues: defaultValues(null),
  });
  const { reset } = form;
  const source = useWatch({ control: form.control, name: "source" });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await productCommissionService.get(productId);
      setSetting(result);
      reset(defaultValues(result));
    } catch (error) {
      reportApiError(error, "productCommission.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [productId, reset]);

  useEffect(() => {
    if (!canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [canView, load]);

  const save = form.handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      const result = await productCommissionService.set(
        productId,
        toProductCommissionInput(values),
      );
      setSetting(result);
      reset(defaultValues(result));
      toast.success(t("productCommission.form.saved"));
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  });

  const historyColumns = useMemo<CompactDetailColumn<ProductCommissionHistoryRow>[]>(
    () => [
      {
        id: "rate",
        header: t("productCommission.history.rate"),
        align: "end",
        cell: (row) => <SemanticValue kind="number">{formatRate(row.ratePercent)}</SemanticValue>,
      },
      {
        id: "from",
        header: t("productCommission.history.from"),
        cell: (row) => <SemanticValue kind="date">{formatDate(row.effectiveFrom)}</SemanticValue>,
      },
      {
        id: "to",
        header: t("productCommission.history.to"),
        cell: (row) =>
          row.effectiveTo ? (
            <SemanticValue kind="date">{formatDate(row.effectiveTo)}</SemanticValue>
          ) : (
            t("productCommission.history.openEnded")
          ),
      },
      {
        id: "reason",
        header: t("productCommission.history.reason"),
        cell: (row) => row.reason || "—",
      },
    ],
    [t],
  );

  if (!canView || (!setting && !isLoading)) return null;

  return (
    <ModalSection
      title={t("productCommission.title")}
      description={t("productCommission.description")}
      columns={4}
      collapsible
    >
      <ModalFieldFullWidth>
        <DetailFieldGrid columns={4}>
          <DetailField
            label={t("productCommission.ownership")}
            value={
              setting
                ? [
                    t(`productCommission.ownershipValue.${setting.ownership}`),
                    setting.ownerAgent
                      ? `${setting.ownerAgent.name} (${setting.ownerAgent.agentNumber})`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" — ")
                : "—"
            }
          />
          <DetailField
            label={t("productCommission.class")}
            value={
              setting
                ? t(`productCommission.classValue.${setting.commissionClass ?? "UNSET"}`)
                : "—"
            }
          />
          <DetailField
            label={t("productCommission.source")}
            value={
              setting ? (
                <StatusBadge
                  label={t(`productCommission.sourceValue.${setting.source}`)}
                  tone={setting.source === "OVERRIDE" ? "info" : "neutral"}
                />
              ) : (
                "—"
              )
            }
          />
          <DetailField
            label={t("productCommission.currentRate")}
            value={
              setting?.source === "OVERRIDE" && setting.overrideRatePercent != null ? (
                <SemanticValue kind="number">
                  {formatRate(setting.overrideRatePercent)}
                </SemanticValue>
              ) : (
                t("productCommission.sourceValue.INHERIT")
              )
            }
          />
        </DetailFieldGrid>
        <p className="mt-1 text-caption text-muted-foreground">
          {t("productCommission.classHint")}
        </p>
      </ModalFieldFullWidth>

      {canEdit && setting ? (
        // Not a <form>: this section renders inside the product modal's own form.
        <Form {...form}>
          <SelectFormField
            control={form.control}
            name="source"
            label={t("productCommission.source")}
            required
            options={(["INHERIT", "OVERRIDE"] as const).map((value) => ({
              value,
              label: t(`productCommission.sourceValue.${value}`),
            }))}
          />
          {source === "OVERRIDE" ? (
            <NumberFormField
              control={form.control}
              name="ratePercent"
              label={t("productCommission.form.ratePercent")}
              description={t("productCommission.form.zeroHint")}
              required
              min={0}
              max={100}
              step="0.0001"
            />
          ) : null}
          <DateFormField
            control={form.control}
            name="effectiveFrom"
            label={t("productCommission.form.effectiveFrom")}
            description={t("productCommission.form.effectiveFromHint")}
            required
          />
          <TextFormField
            control={form.control}
            name="reason"
            label={t("productCommission.form.reason")}
            optional
            maxLength={500}
          />
          <ModalFieldFullWidth className="flex justify-end">
            <EnterpriseButton
              type="button"
              variant="outline"
              isLoading={isSaving}
              disabled={isSaving || isLoading}
              onClick={() => void save()}
            >
              {t("productCommission.form.save")}
            </EnterpriseButton>
          </ModalFieldFullWidth>
        </Form>
      ) : null}

      <ModalFieldFullWidth>
        <p className="mb-1 text-caption font-medium text-muted-foreground">
          {t("productCommission.history.title")}
        </p>
        <CompactDetailTable
          columns={historyColumns}
          rows={setting?.history ?? []}
          rowKey={(row) => row.id}
          empty={t("productCommission.history.empty")}
        />
      </ModalFieldFullWidth>
    </ModalSection>
  );
}

/**
 * Spec 2 (R5) 2A — commission choice for an agent-owned product that has no
 * setting yet (a new product, or one just assigned to an agent): inherit the
 * agreement or an item override, saved together with the product.
 */
export function ProductCommissionDraftSection({
  value,
  onChange,
  showErrors,
}: {
  value: ProductCommissionDraft;
  onChange: (value: ProductCommissionDraft) => void;
  showErrors: boolean;
}) {
  const { t } = useLocale();
  const rateId = "product-commission-draft-rate";
  const invalid = showErrors && commissionDraftInvalid(value);
  return (
    <ModalSection
      title={t("agentPricing.commissionDraft.title")}
      description={t("agentPricing.commissionDraft.description")}
      columns={2}
    >
      <div className="flex flex-col gap-1.5">
        <Label>{t("agentPricing.commissionDraft.source")}</Label>
        <SegmentedRadioGroup
          aria-label={t("agentPricing.commissionDraft.source")}
          value={value.source}
          onValueChange={(source) => onChange({ ...value, source })}
          options={(["INHERIT", "OVERRIDE"] as const).map((source) => ({
            value: source,
            label: t(`productCommission.sourceValue.${source}`),
          }))}
        />
      </div>
      {value.source === "OVERRIDE" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={rateId}>
            {t("agentPricing.commissionDraft.ratePercent")} <RequiredMark className="ms-0.5" />
          </Label>
          <Input
            id={rateId}
            dir="ltr"
            inputMode="decimal"
            value={value.rate}
            aria-invalid={invalid || undefined}
            onChange={(event) => onChange({ ...value, rate: event.target.value })}
          />
          {invalid ? (
            <FieldMessage announce={false}>
              {t("agentPricing.commissionDraft.rateRequired")}
            </FieldMessage>
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("agentPricing.commissionDraft.zeroHint")}
            </p>
          )}
        </div>
      ) : null}
    </ModalSection>
  );
}
