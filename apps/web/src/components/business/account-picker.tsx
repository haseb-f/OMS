"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, X, Landmark } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandPopoverContent,
  CommandResultRow,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EnterpriseButton } from "@/components/ui/button";
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

/**
 * Accounting Configuration (TASK-047) — the ONE Chart of Account search/
 * select every account-mapping field (Accounting Settings, Product
 * Category / Customer Group / Supplier Group overrides) uses. Same
 * Popover+Command combobox pattern as every other picker — no bespoke
 * dropdown for accounts. Nullable/clearable since almost every use here is
 * an optional override.
 */
export function AccountPicker({
  value,
  onChange,
  disabled,
  placeholder,
  /** Excludes these ids from the results — e.g. the account being edited itself and every one of its own descendants, so a circular parent relationship is never even selectable (Part 8/10). */
  excludeIds,
  /** Only shows accounts of this classification — e.g. when picking a Parent Account, restricted to the same `accountType` the new/edited account already has (Part 13). */
  accountType,
}: {
  value: ChartOfAccountRow | null | undefined;
  onChange: (account: ChartOfAccountRow | null) => void;
  disabled?: boolean;
  placeholder?: string;
  excludeIds?: string[];
  accountType?: ChartOfAccountRow["accountType"];
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ChartOfAccountRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const excludeKey = excludeIds?.join(",") ?? "";

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      const runSearch = async () => {
        setIsLoading(true);
        try {
          const result = await accountsService.list({
            search: search || undefined,
            pageSize: 20,
            ...(accountType ? { accountType } : {}),
          });
          const excluded = new Set(excludeKey ? excludeKey.split(",") : []);
          setResults(result.items.filter((item) => !excluded.has(item.id)));
        } catch {
          setResults([]);
        } finally {
          setIsLoading(false);
        }
      };
      void runSearch();
    }, 200);
    return () => clearTimeout(timeout);
  }, [search, open, accountType, excludeKey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center gap-1">
        <PopoverTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full flex-1 justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Landmark className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {value
                  ? `${value.code} — ${value.name}`
                  : (placeholder ?? t("accounting.settings.picker.select"))}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </EnterpriseButton>
        </PopoverTrigger>
        {/* A single trigger element owns the whole combobox; the clear action is a separate sibling button rather than a click handler nested inside the trigger (an icon there would be inert — EnterpriseButton sets `pointer-events-none` on every icon it contains). */}
        {value && !disabled && (
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 shrink-0"
            aria-label={t("accounting.settings.picker.clear")}
            onClick={() => onChange(null)}
          >
            <X className="size-3.5 text-muted-foreground" />
          </EnterpriseButton>
        )}
      </div>
      <CommandPopoverContent>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("accounting.settings.picker.searchPlaceholder")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {!isLoading && results.length === 0 && (
              <CommandEmpty>{t("accounting.settings.picker.noResults")}</CommandEmpty>
            )}
            <CommandGroup>
              {results.map((account) => (
                <CommandItem
                  key={account.id}
                  value={account.id}
                  onSelect={() => {
                    onChange(account);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-checked={value?.id === account.id}
                >
                  <CommandResultRow
                    title={account.name}
                    subtitle={
                      account.parentAccount
                        ? `${account.code} · ${account.parentAccount.name}`
                        : `${account.code} · ${t(ACCOUNT_TYPE_LABEL_KEY[account.accountType])}`
                    }
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
