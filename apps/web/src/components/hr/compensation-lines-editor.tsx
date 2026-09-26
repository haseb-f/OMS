"use client";

import { Plus, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { usePayrollComponents } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";

export interface CompensationLineDraft {
  payrollComponentId: string;
  amount: number | undefined;
}

/**
 * The recurring Earning/Deduction repeater behind Compensation's "التعويضات"
 * step (Employee wizard Step 3) and the Profile's "Add Salary Revision"
 * dialog — the one shared editor for `RecordCompensationDto.lines`, never
 * duplicated between the two entry points.
 */
export function CompensationLinesEditor({
  lines,
  onChange,
}: {
  lines: CompensationLineDraft[];
  onChange: (lines: CompensationLineDraft[]) => void;
}) {
  const { t } = useLocale();
  const components = usePayrollComponents();

  const update = (index: number, patch: Partial<CompensationLineDraft>) => {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };
  const componentOptions = components.map((component) => ({
    value: component.id,
    label:
      component.type === "DEDUCTION"
        ? `${component.nameAr} (${t("hr.payrollComponents.type.DEDUCTION")})`
        : component.nameAr,
    searchText: component.nameEn ?? undefined,
  }));
  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));
  const add = () => onChange([...lines, { payrollComponentId: "", amount: undefined }]);

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchableSelect
              value={line.payrollComponentId}
              onValueChange={(value) => update(index, { payrollComponentId: value })}
              options={componentOptions}
              placeholder={t("hr.compensation.fields.component")}
              aria-label={t("hr.compensation.fields.component")}
            />
          </div>
          <Input
            type="number"
            className="w-32 shrink-0"
            placeholder={t("hr.compensation.fields.amount")}
            value={line.amount ?? ""}
            onChange={(event) => {
              const raw = event.target.valueAsNumber;
              update(index, { amount: Number.isNaN(raw) ? undefined : raw });
            }}
          />
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.delete")}
            onClick={() => remove(index)}
          >
            <X className="size-4" />
          </EnterpriseButton>
        </div>
      ))}
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="self-start"
      >
        <Plus />
        {t("hr.compensation.addLine")}
      </EnterpriseButton>
    </div>
  );
}
