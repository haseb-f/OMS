"use client";

import { Plus, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));
  const add = () => onChange([...lines, { payrollComponentId: "", amount: undefined }]);

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => (
        <div key={index} className="flex items-center gap-2">
          <Select
            value={line.payrollComponentId}
            onValueChange={(value) => update(index, { payrollComponentId: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("hr.compensation.fields.component")} />
            </SelectTrigger>
            <SelectContent>
              {components.map((component) => (
                <SelectItem key={component.id} value={component.id}>
                  {component.nameAr}
                  {component.type === "DEDUCTION"
                    ? ` (${t("hr.payrollComponents.type.DEDUCTION")})`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
