"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  REQUIRED_STATEMENT_FIELDS,
  STATEMENT_FIELDS,
  type StatementDateFormat,
  type StatementField,
  type StatementMapping,
} from "@/services/payment-reconciliation-service";

const NONE = "__none";
const DATE_FORMATS: StatementDateFormat[] = ["DMY", "MDY", "YMD"];

/** Column mapping step shared by the file import wizard and the Google Sheet connection. */
export function MappingEditor({
  headers,
  mapping,
  onChange,
  disabled,
}: {
  headers: string[];
  mapping: StatementMapping;
  onChange: (next: StatementMapping) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const idPrefix = useId();
  const setColumn = (field: StatementField, header: string) => {
    const columns = { ...mapping.columns };
    if (header === NONE) delete columns[field];
    else columns[field] = header;
    onChange({ ...mapping, columns });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {STATEMENT_FIELDS.map((field) => {
          const id = `${idPrefix}-${field}`;
          const required = REQUIRED_STATEMENT_FIELDS.includes(field);
          return (
            <div key={field} className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={id}>
                {t(`paymentReconciliation.fields.${field}` as MessageKey)}
                {required ? (
                  <span className="text-caption text-destructive">
                    {" "}
                    · {t("paymentReconciliation.import.required")}
                  </span>
                ) : null}
              </Label>
              <Select
                value={mapping.columns[field] ?? NONE}
                onValueChange={(value) => setColumn(field, value)}
                disabled={disabled}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("paymentReconciliation.import.notMapped")}
                  </SelectItem>
                  {headers
                    .filter((header) => header.trim())
                    .map((header) => (
                      <SelectItem key={header} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-currency-default`}>
            {t("paymentReconciliation.import.defaultCurrency")}
          </Label>
          <CurrencyPicker
            id={`${idPrefix}-currency-default`}
            value={mapping.defaultCurrencyCode ?? null}
            onValueChange={(code) => onChange({ ...mapping, defaultCurrencyCode: code || null })}
            allowClear
            disabled={disabled}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-date-format`}>
            {t("paymentReconciliation.import.dateFormat")}
          </Label>
          <Select
            value={mapping.dateFormat ?? "DMY"}
            onValueChange={(value) =>
              onChange({ ...mapping, dateFormat: value as StatementDateFormat })
            }
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-date-format`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((format) => (
                <SelectItem key={format} value={format}>
                  {t(`paymentReconciliation.import.dateFormats.${format}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-phone-region`}>
            {t("paymentReconciliation.import.phoneRegion")}
          </Label>
          <Input
            id={`${idPrefix}-phone-region`}
            dir="ltr"
            maxLength={2}
            value={mapping.phoneRegion ?? ""}
            placeholder={t("paymentReconciliation.import.phoneRegionPlaceholder")}
            onChange={(event) =>
              onChange({ ...mapping, phoneRegion: event.target.value.toUpperCase() || null })
            }
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
