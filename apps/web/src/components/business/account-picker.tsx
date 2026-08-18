"use client";

import { Landmark } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

const ACCOUNT_TYPE_LABEL_KEY: Record<ChartOfAccountRow["accountType"], MessageKey> = {
  ASSET: "masterData.fields.accountTypeAsset",
  LIABILITY: "masterData.fields.accountTypeLiability",
  EQUITY: "masterData.fields.accountTypeEquity",
  REVENUE: "masterData.fields.accountTypeRevenue",
  EXPENSE: "masterData.fields.accountTypeExpense",
};

export function AccountPicker({
  value,
  onChange,
  disabled,
  placeholder,
  excludeIds,
  accountType,
  postingOnly,
}: {
  value: ChartOfAccountRow | null | undefined;
  onChange: (account: ChartOfAccountRow | null) => void;
  disabled?: boolean;
  placeholder?: string;
  excludeIds?: string[];
  accountType?: ChartOfAccountRow["accountType"];
  postingOnly?: boolean;
}) {
  const { t } = useLocale();
  const excluded = new Set(excludeIds ?? []);

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={onChange}
      onSearch={async (search) => {
        const result = await accountsService.list({
          search: search || undefined,
          pageSize: 20,
          ...(accountType ? { accountType } : {}),
        });
        return result.items.filter(
          (item) => !excluded.has(item.id) && (!postingOnly || item.allowsPosting),
        );
      }}
      getId={(account) => account.id}
      getTitle={(account) => account.name}
      getSubtitle={(account) =>
        account.parentAccount
          ? `${account.code} · ${account.parentAccount.name}`
          : `${account.code} · ${t(ACCOUNT_TYPE_LABEL_KEY[account.accountType])}`
      }
      subtitleDir="ltr"
      placeholder={placeholder ?? t("accounting.settings.picker.select")}
      searchPlaceholder={t("accounting.settings.picker.searchPlaceholder")}
      emptyText={t("accounting.settings.picker.noResults")}
      disabled={disabled}
      allowClear
      icon={<Landmark className="size-4 shrink-0 text-muted-foreground" />}
    />
  );
}
