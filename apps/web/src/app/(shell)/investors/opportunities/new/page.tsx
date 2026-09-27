"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Plus, Save, Trash2 } from "lucide-react";
import { EditorWorkspace, EditorHeader, DetailSection } from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { MasterDataForm } from "@/components/master-data/master-data-form";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/components/business/product-picker";
import type { ProductRow } from "@/services/products-service";
import { useCurrencies } from "@/hooks/use-reference-data";
import {
  investmentOpportunitiesService,
  type CreateInvestmentOpportunityPayload,
} from "@/services/investment-opportunities-service";
import { useLocale } from "@/providers/locale-provider";
import { toast, reportApiError } from "@/lib/toast";
import { formatAmount } from "@/lib/money";
import { KpiCard } from "@/components/shared/kpi-card";
import { Label } from "@/components/ui/label";

interface ProductLine {
  product: ProductRow | null;
  fundedUnits: number;
  fundedUnitCost: number;
}

interface OpportunityFormValues {
  nameAr: string;
  nameEn: string;
  description: string;
  currencyId: string;
  startDate: string;
  endDate: string;
  investorNetProfitSharePercent: number;
}

export default function NewInvestmentOpportunityPage() {
  const { t } = useLocale();
  const router = useRouter();
  const currencies = useCurrencies();
  const [isSaving, setIsSaving] = useState(false);
  const [products, setProducts] = useState<ProductLine[]>([
    { product: null, fundedUnits: 0, fundedUnitCost: 0 },
  ]);

  const form = useForm<OpportunityFormValues>({
    defaultValues: {
      nameAr: "",
      nameEn: "",
      description: "",
      currencyId: "",
      startDate: "",
      endDate: "",
      investorNetProfitSharePercent: 0,
    },
  });

  function updateLine(index: number, patch: Partial<ProductLine>) {
    setProducts((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setProducts((prev) => [...prev, { product: null, fundedUnits: 0, fundedUnitCost: 0 }]);
  }

  function removeLine(index: number) {
    setProducts((prev) => prev.filter((_, i) => i !== index));
  }

  const targetCapital = products.reduce(
    (sum, line) => sum + (line.fundedUnits || 0) * (line.fundedUnitCost || 0),
    0,
  );

  async function handleSave() {
    const values = form.getValues();
    const validLines = products.filter(
      (line) => line.product && line.fundedUnits > 0 && line.fundedUnitCost > 0,
    );
    if (!values.nameAr.trim()) {
      toast.error(t("investors.opportunities.fields.nameAr"));
      return;
    }
    if (!values.currencyId || !values.startDate || !values.endDate) {
      toast.error(t("common.required"));
      return;
    }
    if (validLines.length === 0) {
      toast.error(t("investors.opportunities.create.addProduct"));
      return;
    }

    const payload: CreateInvestmentOpportunityPayload = {
      nameAr: values.nameAr,
      nameEn: values.nameEn || undefined,
      description: values.description || undefined,
      currencyId: values.currencyId,
      startDate: values.startDate,
      endDate: values.endDate,
      investorNetProfitSharePercent: Number(values.investorNetProfitSharePercent),
      products: validLines.map((line) => ({
        productId: line.product!.id,
        fundedUnits: Number(line.fundedUnits),
        fundedUnitCost: Number(line.fundedUnitCost),
      })),
    };

    setIsSaving(true);
    try {
      const created = await investmentOpportunitiesService.create(payload);
      toast.success(t("common.saved"));
      router.push(`/investors/opportunities/${created.id}`);
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  }

  const selectedCurrency = currencies.find((c) => c.id === form.watch("currencyId"));

  return (
    <EditorWorkspace>
      <EditorHeader
        title={t("investors.opportunities.addNew")}
        actions={
          <HeaderActions
            primary={{
              key: "save-draft",
              label: t("investors.opportunities.create.saveAsDraft"),
              icon: Save,
              disabled: isSaving,
              onSelect: () => void handleSave(),
            }}
          />
        }
      />

      <DetailSection title={t("investors.opportunities.create.sectionDetails")}>
        <MasterDataForm
          form={form}
          fields={[
            {
              name: "nameAr",
              label: "investors.opportunities.fields.nameAr",
              type: "text",
              required: true,
            },
            { name: "nameEn", label: "investors.opportunities.fields.nameEn", type: "text" },
            {
              name: "currencyId",
              label: "investors.opportunities.fields.currency",
              type: "select",
              required: true,
              options: currencies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
            },
            {
              name: "startDate",
              label: "investors.opportunities.fields.startDate",
              type: "date",
              required: true,
            },
            {
              name: "endDate",
              label: "investors.opportunities.fields.endDate",
              type: "date",
              required: true,
            },
            {
              name: "investorNetProfitSharePercent",
              label: "investors.opportunities.fields.investorNetProfitSharePercent",
              type: "number",
              required: true,
            },
            {
              name: "description",
              label: "investors.opportunities.fields.description",
              type: "textarea",
            },
          ]}
          sectionTitle={t("investors.opportunities.create.sectionDetails")}
          columns={3}
        />
      </DetailSection>

      <DetailSection
        title={t("investors.opportunities.create.sectionProducts")}
        actions={
          <EnterpriseButton type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus />
            {t("investors.opportunities.create.addProduct")}
          </EnterpriseButton>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">
            {t("investors.opportunities.create.productsEligibilityHint")}
          </p>
          <div
            aria-hidden
            className="hidden gap-2 px-1 text-caption text-muted-foreground md:grid md:grid-cols-12"
          >
            <span className="md:col-span-5">{t("investors.opportunities.create.addProduct")}</span>
            <span className="md:col-span-2">{t("investors.opportunities.create.fundedUnits")}</span>
            <span className="md:col-span-2">
              {t("investors.opportunities.create.fundedUnitCost")}
            </span>
            <span className="text-end md:col-span-2">
              {t("investors.opportunities.create.lineCapital")}
            </span>
            <span className="md:col-span-1" />
          </div>
          {products.map((line, index) => (
            <div
              key={index}
              className="grid grid-cols-2 items-center gap-2 rounded-md border border-border p-2 md:grid-cols-12 md:rounded-none md:border-0 md:p-0"
            >
              <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-5">
                <Label className="md:sr-only">
                  {t("investors.opportunities.create.addProduct")}
                </Label>
                <ProductPicker
                  value={line.product}
                  onChange={(product) => updateLine(index, { product })}
                  sellableOnly={false}
                  investmentEligibleOnly
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1 md:col-span-2">
                <Label className="md:sr-only">
                  {t("investors.opportunities.create.fundedUnits")}
                </Label>
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  aria-label={t("investors.opportunities.create.fundedUnits")}
                  value={line.fundedUnits || ""}
                  onChange={(e) => updateLine(index, { fundedUnits: Number(e.target.value) })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1 md:col-span-2">
                <Label className="md:sr-only">
                  {t("investors.opportunities.create.fundedUnitCost")}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  aria-label={t("investors.opportunities.create.fundedUnitCost")}
                  value={line.fundedUnitCost || ""}
                  onChange={(e) => updateLine(index, { fundedUnitCost: Number(e.target.value) })}
                />
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2 md:col-span-2 md:justify-end">
                <span className="text-caption text-muted-foreground md:sr-only">
                  {t("investors.opportunities.create.lineCapital")}
                </span>
                <span className="text-body font-medium">
                  <span className="num">
                    {formatAmount((line.fundedUnits || 0) * (line.fundedUnitCost || 0), {
                      currency: selectedCurrency?.code,
                    })}
                  </span>
                </span>
              </div>
              <div className="flex justify-end md:col-span-1">
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("common.delete")}
                  onClick={() => removeLine(index)}
                  disabled={products.length === 1}
                >
                  <Trash2 />
                </EnterpriseButton>
              </div>
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title={t("investors.opportunities.create.sectionSummary")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard
            label={t("investors.opportunities.fields.targetCapital")}
            value={formatAmount(targetCapital, { currency: selectedCurrency?.code })}
          />
          <KpiCard
            label={t("investors.opportunities.create.productsCount")}
            value={products.filter((line) => line.product).length}
          />
        </div>
      </DetailSection>
    </EditorWorkspace>
  );
}
