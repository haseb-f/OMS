"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Plus, Save, Trash2 } from "lucide-react";
import { EditorWorkspace, EditorHeader, DetailSection } from "@/components/shared/detail-workspace";
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
import { formatMoney } from "@/lib/money";

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
          <EnterpriseButton type="button" onClick={() => void handleSave()} disabled={isSaving}>
            <Save />
            {t("investors.opportunities.create.saveAsDraft")}
          </EnterpriseButton>
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
          <EnterpriseButton type="button" variant="secondary" size="sm" onClick={addLine}>
            <Plus />
            {t("investors.opportunities.create.addProduct")}
          </EnterpriseButton>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 px-1 text-caption text-muted-foreground">
            <span>{t("investors.opportunities.create.addProduct")}</span>
            <span>{t("investors.opportunities.create.fundedUnits")}</span>
            <span>{t("investors.opportunities.create.fundedUnitCost")}</span>
            <span>{t("investors.opportunities.create.lineCapital")}</span>
            <span />
          </div>
          {products.map((line, index) => (
            <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-center gap-2">
              <ProductPicker
                value={line.product}
                onChange={(product) => updateLine(index, { product })}
              />
              <Input
                type="number"
                min={0}
                value={line.fundedUnits || ""}
                onChange={(e) => updateLine(index, { fundedUnits: Number(e.target.value) })}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={line.fundedUnitCost || ""}
                onChange={(e) => updateLine(index, { fundedUnitCost: Number(e.target.value) })}
              />
              <span className="text-body font-medium">
                {formatMoney(
                  (line.fundedUnits || 0) * (line.fundedUnitCost || 0),
                  selectedCurrency?.code,
                )}
              </span>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeLine(index)}
                disabled={products.length === 1}
              >
                <Trash2 />
              </EnterpriseButton>
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title={t("investors.opportunities.create.sectionSummary")}>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-caption text-muted-foreground">
              {t("investors.opportunities.fields.targetCapital")}
            </div>
            <div className="text-ui-title font-semibold">
              {formatMoney(targetCapital, selectedCurrency?.code)}
            </div>
          </div>
          <div>
            <div className="text-caption text-muted-foreground">
              {t("investors.opportunities.create.productsCount")}
            </div>
            <div className="text-ui-title font-semibold">
              {products.filter((line) => line.product).length}
            </div>
          </div>
        </div>
      </DetailSection>
    </EditorWorkspace>
  );
}
