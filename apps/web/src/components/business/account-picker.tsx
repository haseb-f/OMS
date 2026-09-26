"use client";

import { Landmark } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { cachedLookup } from "@/lib/lookup-cache";
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
  items,
  id,
  "aria-label": ariaLabel,
}: {
  value: ChartOfAccountRow | null | undefined;
  onChange: (account: ChartOfAccountRow | null) => void;
  disabled?: boolean;
  placeholder?: string;
  excludeIds?: string[];
  accountType?: ChartOfAccountRow["accountType"];
  postingOnly?: boolean;
  /** Skip the async search and filter this already-fetched list instead — for callers (e.g. a line-grid) that prefetch the account list once for the whole page rather than per-row. */
  items?: ChartOfAccountRow[];
  /** Forwarded to the trigger so an external `<Label htmlFor>` / `FormControl` can name it. */
  id?: string;
  "aria-label"?: string;
}) {
  const { t } = useLocale();
  const excluded = new Set(excludeIds ?? []);

  return (
    <EntityCombobox
      id={id}
      triggerProps={{ "aria-label": ariaLabel }}
      value={value ?? null}
      onChange={onChange}
      items={items}
      onSearch={
        items
          ? undefined
          : async (search) => {
              const params = {
                search: search || undefined,
                pageSize: 25,
                ...(accountType ? { accountType } : {}),
                ...(postingOnly ? { postingOnly: true } : {}),
              };
              const result = await cachedLookup(`accounts:${JSON.stringify(params)}`, () =>
                accountsService.list(params),
              );
              return result.items.filter((item) => !excluded.has(item.id));
            }
      }
      getId={(account) => account.id}
      getTitle={(account) => account.name}
      getSearchText={(account) => `${account.code} ${account.parentAccount?.name ?? ""}`}
      getSubtitle={(account) =>
        account.parentAccount
          ? account.parentAccount.name
          : t(ACCOUNT_TYPE_LABEL_KEY[account.accountType])
      }
      placeholder={placeholder ?? t("accounting.settings.picker.select")}
      searchPlaceholder={t("accounting.settings.picker.searchPlaceholder")}
      emptyText={t("accounting.settings.picker.noResults")}
      disabled={disabled}
      allowClear
      icon={<Landmark className="size-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
