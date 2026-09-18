"use client";

import { useEffect, useMemo, useState } from "react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { AccountPicker } from "@/components/business/account-picker";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import type { ChartOfAccountRow, CurrencyRow } from "@/config/master-data/entities";
import {
  accountingSettingsService,
  type AccountRef,
  type AccountingSettingsField,
  type AccountingSettingsRow,
} from "@/services/accounting-settings-service";
import {
  investorAccountingSettingsService,
  type InvestorAccountingSettingsField,
  type InvestorAccountingSettingsRow,
} from "@/services/investor-accounting-settings-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { useCurrencies } from "@/hooks/use-reference-data";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";
import { Banknote } from "lucide-react";

interface FieldConfig {
  key: AccountingSettingsField;
  labelKey: MessageKey;
  required?: boolean;
}
interface SectionConfig {
  titleKey: MessageKey;
  fields: FieldConfig[];
}

const SECTIONS: SectionConfig[] = [
  {
    titleKey: "accounting.settings.sections.general",
    fields: [
      { key: "cashAccountId", labelKey: "accounting.settings.fields.cash" },
      { key: "bankAccountId", labelKey: "accounting.settings.fields.bank" },
      { key: "roundDifferenceAccountId", labelKey: "accounting.settings.fields.roundDifference" },
      {
        key: "exchangeDifferenceAccountId",
        labelKey: "accounting.settings.fields.exchangeDifference",
      },
      { key: "suspenseAccountId", labelKey: "accounting.settings.fields.suspense" },
      {
        key: "defaultExpenseAccountId",
        labelKey: "accounting.settings.fields.defaultExpense",
        required: true,
      },
    ],
  },
  {
    titleKey: "accounting.settings.sections.sales",
    fields: [
      {
        key: "salesRevenueAccountId",
        labelKey: "accounting.settings.fields.salesRevenue",
        required: true,
      },
      { key: "salesDiscountAccountId", labelKey: "accounting.settings.fields.salesDiscount" },
      { key: "salesReturnAccountId", labelKey: "accounting.settings.fields.salesReturn" },
    ],
  },
  {
    titleKey: "accounting.settings.sections.purchasing",
    fields: [
      { key: "purchaseAccountId", labelKey: "accounting.settings.fields.purchase" },
      { key: "purchaseDiscountAccountId", labelKey: "accounting.settings.fields.purchaseDiscount" },
      { key: "purchaseReturnAccountId", labelKey: "accounting.settings.fields.purchaseReturn" },
    ],
  },
  {
    titleKey: "accounting.settings.sections.inventory",
    fields: [
      {
        key: "costOfGoodsSoldAccountId",
        labelKey: "accounting.settings.fields.cogs",
        required: true,
      },
      {
        key: "inventoryAccountId",
        labelKey: "accounting.settings.fields.inventoryAsset",
        required: true,
      },
      {
        key: "inventoryAdjustmentAccountId",
        labelKey: "accounting.settings.fields.inventoryAdjustment",
      },
      {
        key: "landedCostClearingAccountId",
        labelKey: "accounting.settings.fields.landedCostClearing",
      },
    ],
  },
  {
    titleKey: "accounting.settings.sections.operating",
    fields: [
      {
        key: "shippingExpenseAccountId",
        labelKey: "accounting.settings.fields.shippingExpense",
        required: true,
      },
      {
        key: "accruedShippingAccountId",
        labelKey: "accounting.settings.fields.accruedShipping",
        required: true,
      },
      {
        key: "paymentGatewayFeeAccountId",
        labelKey: "accounting.settings.fields.paymentGatewayFee",
        required: true,
      },
      {
        key: "fulfillmentExpenseAccountId",
        labelKey: "accounting.settings.fields.fulfillmentExpense",
        required: true,
      },
      {
        key: "accruedFulfillmentAccountId",
        labelKey: "accounting.settings.fields.accruedFulfillment",
        required: true,
      },
    ],
  },
  {
    titleKey: "accounting.settings.sections.assets",
    fields: [
      { key: "fixedAssetsAccountId", labelKey: "accounting.settings.fields.fixedAssets" },
      {
        key: "accumDepreciationAccountId",
        labelKey: "accounting.settings.fields.accumDepreciation",
      },
      {
        key: "depreciationExpenseAccountId",
        labelKey: "accounting.settings.fields.depreciationExpense",
      },
      { key: "prepaymentsAccountId", labelKey: "accounting.settings.fields.prepayments" },
      { key: "accruedExpensesAccountId", labelKey: "accounting.settings.fields.accruedExpenses" },
      { key: "otherIncomeAccountId", labelKey: "accounting.settings.fields.otherIncome" },
      { key: "otherExpenseAccountId", labelKey: "accounting.settings.fields.otherExpense" },
      { key: "unrealizedFxAccountId", labelKey: "accounting.settings.fields.unrealizedFx" },
    ],
  },
  {
    titleKey: "accounting.settings.sections.tax",
    fields: [
      {
        key: "vatOutputAccountId",
        labelKey: "accounting.settings.fields.vatOutput",
        required: true,
      },
      { key: "vatInputAccountId", labelKey: "accounting.settings.fields.vatInput", required: true },
    ],
  },
  {
    titleKey: "accounting.settings.sections.customerDefaults",
    fields: [
      {
        key: "accountsReceivableAccountId",
        labelKey: "accounting.settings.fields.accountsReceivable",
        required: true,
      },
    ],
  },
  {
    titleKey: "accounting.settings.sections.supplierDefaults",
    fields: [
      {
        key: "accountsPayableAccountId",
        labelKey: "accounting.settings.fields.accountsPayable",
        required: true,
      },
    ],
  },
  {
    titleKey: "accounting.settings.sections.equity",
    fields: [
      {
        key: "retainedEarningsAccountId",
        labelKey: "accounting.settings.fields.retainedEarnings",
      },
    ],
  },
  {
    titleKey: "accounting.settings.sections.payroll",
    fields: [
      {
        key: "payrollPayableAccountId",
        labelKey: "accounting.settings.fields.payrollPayable",
        required: true,
      },
      {
        key: "salaryExpenseAccountId",
        labelKey: "accounting.settings.fields.salaryExpense",
        required: true,
      },
      { key: "kpiExpenseAccountId", labelKey: "accounting.settings.fields.kpiExpense" },
      {
        key: "commissionExpenseAccountId",
        labelKey: "accounting.settings.fields.commissionExpense",
      },
      {
        key: "defaultAllowanceExpenseAccountId",
        labelKey: "accounting.settings.fields.defaultAllowanceExpense",
      },
      {
        key: "defaultDeductionAccountId",
        labelKey: "accounting.settings.fields.defaultDeduction",
      },
    ],
  },
];

interface InvestorFieldConfig {
  key: InvestorAccountingSettingsField;
  labelKey: MessageKey;
}

const INVESTOR_FIELDS: InvestorFieldConfig[] = [
  {
    key: "investorFundingAccountId",
    labelKey: "accounting.settings.fields.investorFunding",
  },
  {
    key: "investorProfitDistributionAccountId",
    labelKey: "accounting.settings.fields.investorProfitDistribution",
  },
  {
    key: "investorProfitPayableAccountId",
    labelKey: "accounting.settings.fields.investorProfitPayable",
  },
  {
    key: "capitalReturnAccountId",
    labelKey: "accounting.settings.fields.capitalReturn",
  },
];

function toChartRow(ref: AccountRef | null): ChartOfAccountRow | null {
  if (!ref) return null;
  return {
    id: ref.id,
    code: ref.code,
    name: ref.name,
    description: null,
    accountType: "ASSET",
    parentAccountId: null,
    currencyId: null,
    allowReconciliation: false,
    level: 1,
    allowsPosting: true,
    isSystemAccount: false,
    deletedAt: null,
  };
}

export default function AccountingSettingsPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const currencies = useCurrencies();
  const canViewInvestorSettings = hasPermission("investment-accounting.view");
  const canConfigureInvestorSettings = hasPermission("investment-accounting.configure");
  const [settings, setSettings] = useState<AccountingSettingsRow | null>(null);
  const [values, setValues] = useState<Record<string, ChartOfAccountRow | null>>({});
  const [functionalCurrency, setFunctionalCurrency] = useState<CurrencyRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const [investorValues, setInvestorValues] = useState<Record<string, ChartOfAccountRow | null>>(
    {},
  );
  const [isInvestorSaving, setIsInvestorSaving] = useState(false);

  useEffect(() => {
    if (!canViewInvestorSettings) return;
    investorAccountingSettingsService.get().then((row) => {
      const next: Record<string, ChartOfAccountRow | null> = {};
      for (const field of INVESTOR_FIELDS) {
        const refKey = field.key.replace(/Id$/, "") as keyof InvestorAccountingSettingsRow;
        next[field.key] = toChartRow(row[refKey] as AccountRef | null);
      }

      setInvestorValues(next);
    });
  }, [canViewInvestorSettings]);

  const handleSaveInvestor = async () => {
    setIsInvestorSaving(true);
    try {
      const payload: Record<string, string | null> = {};
      for (const field of INVESTOR_FIELDS) {
        payload[field.key] = investorValues[field.key]?.id ?? null;
      }
      await investorAccountingSettingsService.update(payload);
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to save Investor accounting settings.",
      );
    } finally {
      setIsInvestorSaving(false);
    }
  };

  const load = () => {
    setIsLoading(true);
    accountingSettingsService
      .get()
      .then((row) => {
        setSettings(row);
        const next: Record<string, ChartOfAccountRow | null> = {};
        for (const section of SECTIONS) {
          for (const field of section.fields) {
            const refKey = field.key.replace(/Id$/, "") as keyof AccountingSettingsRow;
            next[field.key] = toChartRow(row[refKey] as AccountRef | null);
          }
        }
        setValues(next);
        setFunctionalCurrency(
          row.functionalCurrency
            ? {
                id: row.functionalCurrency.id,
                code: row.functionalCurrency.code,
                name: row.functionalCurrency.name,
                symbol: null,
                deletedAt: null,
              }
            : null,
        );
      })
      .catch((error) =>
        toast.error(
          error instanceof ApiError ? error.message : "Failed to load accounting settings.",
        ),
      )
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const missingRequired = useMemo(
    () =>
      SECTIONS.flatMap((section) => section.fields)
        .filter((field) => field.required && !values[field.key])
        .map((field) => field.labelKey),
    [values],
  );

  const handleSave = async () => {
    if (missingRequired.length > 0) {
      setShowErrors(true);
      toast.error(
        t("accounting.settings.validation.missingRequired", { count: missingRequired.length }),
      );
      return;
    }
    setIsSaving(true);
    try {
      const payload: Record<string, string | null> = {};
      for (const section of SECTIONS) {
        for (const field of section.fields) {
          payload[field.key] = values[field.key]?.id ?? null;
        }
      }
      payload.functionalCurrencyId = functionalCurrency?.id ?? null;
      const updated = await accountingSettingsService.update(payload);
      setSettings(updated);
      setShowErrors(false);
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to save accounting settings.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !settings) {
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageWorkspace
        title={t("accounting.settings.title")}
        description={t("accounting.settings.description")}
        actions={
          <EnterpriseButton
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={isSaving}
            onClick={handleSave}
          >
            {t("common.save")}
          </EnterpriseButton>
        }
      />

      {showErrors && missingRequired.length > 0 && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-caption text-destructive">
          {t("accounting.settings.validation.missingRequired", { count: missingRequired.length })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <EnterpriseCard key={section.titleKey} className="gap-0 py-3">
            <EnterpriseCardHeader className="px-4 pb-2">
              <EnterpriseCardTitle className="text-body">{t(section.titleKey)}</EnterpriseCardTitle>
            </EnterpriseCardHeader>
            <EnterpriseCardContent className="flex flex-col gap-2.5 px-4">
              {section.titleKey === "accounting.settings.sections.general" && (
                <div className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">
                    {t("accounting.settings.fields.functionalCurrency")}
                  </label>
                  <EntityCombobox
                    items={currencies}
                    value={functionalCurrency}
                    onChange={setFunctionalCurrency}
                    getId={(currency) => currency.id}
                    getTitle={(currency) => `${currency.code} — ${currency.name}`}
                    allowClear
                    placeholder={t("common.select")}
                    icon={<Banknote className="size-3.5 shrink-0 text-muted-foreground" />}
                  />
                </div>
              )}
              {section.fields.map((field) => {
                const isMissing = showErrors && field.required && !values[field.key];
                return (
                  <div key={field.key} className="flex flex-col gap-1">
                    <label className="text-caption text-muted-foreground">
                      {t(field.labelKey)}
                      {field.required && <span className="text-destructive"> *</span>}
                    </label>
                    <AccountPicker
                      value={values[field.key]}
                      onChange={(account) =>
                        setValues((prev) => ({ ...prev, [field.key]: account }))
                      }
                    />
                    {isMissing && (
                      <p className="text-xs text-destructive">
                        {t("accounting.settings.validation.required")}
                      </p>
                    )}
                  </div>
                );
              })}
            </EnterpriseCardContent>
          </EnterpriseCard>
        ))}
      </div>

      {canViewInvestorSettings && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EnterpriseCard className="gap-0 py-3">
            <EnterpriseCardHeader className="flex flex-row items-center justify-between px-4 pb-2">
              <EnterpriseCardTitle className="text-body">
                {t("accounting.settings.sections.investors")}
              </EnterpriseCardTitle>
              {canConfigureInvestorSettings && (
                <EnterpriseButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isInvestorSaving}
                  onClick={handleSaveInvestor}
                >
                  {t("common.save")}
                </EnterpriseButton>
              )}
            </EnterpriseCardHeader>
            <EnterpriseCardContent className="flex flex-col gap-2.5 px-4">
              {INVESTOR_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">{t(field.labelKey)}</label>
                  <AccountPicker
                    value={investorValues[field.key]}
                    disabled={!canConfigureInvestorSettings}
                    onChange={(account) =>
                      setInvestorValues((prev) => ({ ...prev, [field.key]: account }))
                    }
                  />
                </div>
              ))}
            </EnterpriseCardContent>
          </EnterpriseCard>
        </div>
      )}
    </div>
  );
}
