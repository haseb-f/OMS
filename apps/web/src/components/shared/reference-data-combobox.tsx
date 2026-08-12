"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandPopoverContent,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { referenceDataService, type ReferenceRecord } from "@/services/reference-data-service";
import { ApiError } from "@/services/api-client";
import { toast } from "@/lib/toast";

/**
 * The ONE searchable Master Data picker for import configuration forms —
 * "Whenever the user selects a field that references Master Data, use a
 * searchable dropdown/combobox backed by the real OMS data... do NOT use
 * free-text input." Give it a `referenceType` (`"COUNTRY"`, `"CURRENCY"`,
 * `"PRODUCT"`, ...) and it fetches active records from
 * `ReferenceDataRegistryService` via `/import-center/reference-data/:type`
 * — never a page-local hardcoded list, so a new active record shows up the
 * next time this opens. Emits the record's `code ?? name` (whichever the
 * backing reference type matches on) as the field value — never the raw
 * id — so the same value a generated Excel Template/Google Sheet dropdown
 * would produce is what gets stored, keeping every entry point consistent.
 */
export function ReferenceDataCombobox({
  referenceType,
  value,
  onChange,
  disabled,
  placeholder,
  allowClear = true,
}: {
  referenceType: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<ReferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    referenceDataService
      .listRecords(referenceType)
      .then((items) => {
        if (!cancelled) setRecords(items);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof ApiError ? error.message : "Failed to load reference data.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [referenceType]);

  const selected = useMemo(
    () => records.find((r) => (r.code ?? r.name) === value) ?? null,
    [records, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected
              ? selected.name
              : loading
                ? t("common.loading")
                : (placeholder ?? t("common.select"))}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent>
        <Command>
          <CommandInput placeholder={t("common.search")} />
          <CommandList>
            <CommandEmpty>{t("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {allowClear && value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground">{t("common.clearSelection")}</span>
                </CommandItem>
              )}
              {records.map((record) => {
                const recordValue = record.code ?? record.name;
                return (
                  <CommandItem
                    key={record.id}
                    value={`${record.name} ${record.code ?? ""}`}
                    onSelect={() => {
                      onChange(recordValue);
                      setOpen(false);
                    }}
                    data-checked={value === recordValue}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{record.name}</span>
                      {record.code && (
                        <span dir="ltr" className="shrink-0 text-caption text-muted-foreground">
                          {record.code}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
