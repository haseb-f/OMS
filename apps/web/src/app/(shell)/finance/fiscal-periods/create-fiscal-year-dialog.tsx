"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { fiscalYearsService, type FiscalYearRow } from "@/services/fiscal-years-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { toISODate } from "@/lib/date";

export function CreateFiscalYearDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (fiscalYear: FiscalYearRow) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setStartDate(null);
    setEndDate(null);
  };

  const handleConfirm = async () => {
    if (!name.trim() || !startDate || !endDate) {
      toast.error(t("accounting.fiscalYears.validation.required"));
      return;
    }
    if (endDate <= startDate) {
      toast.error(t("accounting.fiscalYears.validation.endAfterStart"));
      return;
    }
    setIsSubmitting(true);
    try {
      const fiscalYear = await fiscalYearsService.create({
        name: name.trim(),
        startDate: toISODate(startDate),
        endDate: toISODate(endDate),
      });
      toast.success(t("accounting.fiscalYears.toasts.created"));
      reset();
      onOpenChange(false);
      onCreated(fiscalYear);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      icon={CalendarRange}
      title={t("accounting.fiscalYears.createTitle")}
      description={t("accounting.fiscalYears.createDescription")}
      size="md"
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.close")}
          </EnterpriseButton>
          <EnterpriseButton type="button" disabled={isSubmitting} onClick={handleConfirm}>
            {t("accounting.fiscalYears.createConfirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fiscal-year-name">{t("accounting.fiscalYears.fields.name")}</Label>
          <Input
            id="fiscal-year-name"
            value={name}
            placeholder="FY2027"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("accounting.fiscalYears.fields.startDate")}</Label>
          <EnterpriseDatePicker value={startDate} onChange={setStartDate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("accounting.fiscalYears.fields.endDate")}</Label>
          <EnterpriseDatePicker value={endDate} onChange={setEndDate} />
        </div>
        <p className="text-caption text-muted-foreground">
          {t("accounting.fiscalYears.periodsHint")}
        </p>
      </div>
    </EnterpriseModal>
  );
}
