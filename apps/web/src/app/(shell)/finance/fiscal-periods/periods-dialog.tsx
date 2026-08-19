"use client";

import { useState } from "react";
import { Lock, Unlock, CalendarClock } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/business/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  accountingPeriodsService,
  type FiscalYearRow,
  type AccountingPeriodStatusValue,
} from "@/services/fiscal-years-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import type { StatusTone } from "@/components/business/status-badge";
import type { MessageKey } from "@/i18n/translate";

const STATUS_TONE: Record<AccountingPeriodStatusValue, StatusTone> = {
  OPEN: "success",
  CLOSED: "warning",
  LOCKED: "destructive",
};

const STATUS_LABEL_KEY: Record<AccountingPeriodStatusValue, MessageKey> = {
  OPEN: "accounting.periods.status.OPEN",
  CLOSED: "accounting.periods.status.CLOSED",
  LOCKED: "accounting.periods.status.LOCKED",
};

export function PeriodsDialog({
  fiscalYear,
  onOpenChange,
  onChanged,
}: {
  fiscalYear: FiscalYearRow | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const periods = fiscalYear?.periods ?? [];

  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runBulk = async (
    action: (
      ids: string[],
    ) => Promise<{ succeeded: number; failed: { id: string; message: string }[] }>,
  ) => {
    setIsBulkBusy(true);
    try {
      const result = await action([...selected]);
      if (result.failed.length === 0) {
        toast.success(t("accounting.periods.bulk.success", { count: result.succeeded }));
      } else {
        toast.error(
          t("accounting.periods.bulk.partial", {
            succeeded: result.succeeded,
            failed: result.failed.length,
          }),
        );
      }
      setSelected(new Set());
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open={!!fiscalYear}
      onOpenChange={onOpenChange}
      icon={CalendarClock}
      title={fiscalYear?.name ?? ""}
      description={t("accounting.fiscalYears.periodsDescription")}
      size="lg"
      footer={(requestClose) => (
        <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
          {t("common.close")}
        </EnterpriseButton>
      )}
    >
      <div className="flex flex-col gap-2.5">
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-caption">
            <span className="text-muted-foreground">
              {t("accounting.periods.bulk.selected", { count: selected.size })}
            </span>
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              disabled={isBulkBusy}
              onClick={() => void runBulk((ids) => accountingPeriodsService.bulkClose(ids))}
            >
              {t("accounting.periods.actions.bulkClose")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              disabled={isBulkBusy}
              onClick={() => void runBulk((ids) => accountingPeriodsService.bulkOpen(ids))}
            >
              {t("accounting.periods.actions.bulkOpen")}
            </EnterpriseButton>
          </div>
        )}
        <div className="overflow-x-auto rounded-md border border-border">
          <Table className="w-full">
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={periods.length > 0 && selected.size === periods.length}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? new Set(periods.map((p) => p.id)) : new Set())
                    }
                    aria-label={t("common.selectAll")}
                  />
                </TableHead>
                <TableHead>{t("accounting.periods.fields.name")}</TableHead>
                <TableHead>{t("accounting.periods.fields.startDate")}</TableHead>
                <TableHead>{t("accounting.periods.fields.endDate")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-end">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => (
                <TableRow key={period.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(period.id)}
                      onCheckedChange={(checked) => toggleSelected(period.id, !!checked)}
                      aria-label={period.name}
                    />
                  </TableCell>
                  <TableCell>{period.name}</TableCell>
                  <TableCell dir="ltr">{formatDate(period.startDate)}</TableCell>
                  <TableCell dir="ltr">{formatDate(period.endDate)}</TableCell>
                  <TableCell>
                    <StatusBadge
                      label={t(STATUS_LABEL_KEY[period.status])}
                      tone={STATUS_TONE[period.status]}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1.5">
                      {period.status === "OPEN" && (
                        <EnterpriseButton
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busyId === period.id}
                          onClick={() => {
                            setBusyId(period.id);
                            void runAction(() => accountingPeriodsService.close(period.id));
                          }}
                        >
                          {t("accounting.periods.actions.close")}
                        </EnterpriseButton>
                      )}
                      {period.status === "CLOSED" && (
                        <>
                          <EnterpriseButton
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === period.id}
                            onClick={() => {
                              setBusyId(period.id);
                              void runAction(() => accountingPeriodsService.reopen(period.id));
                            }}
                          >
                            <Unlock className="size-3.5" />
                            {t("accounting.periods.actions.reopen")}
                          </EnterpriseButton>
                          <EnterpriseButton
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={busyId === period.id}
                            onClick={() => {
                              setBusyId(period.id);
                              void runAction(() => accountingPeriodsService.lock(period.id));
                            }}
                          >
                            <Lock className="size-3.5" />
                            {t("accounting.periods.actions.lock")}
                          </EnterpriseButton>
                        </>
                      )}
                      {period.status === "LOCKED" && (
                        <EnterpriseButton
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busyId === period.id}
                          onClick={() => {
                            setBusyId(period.id);
                            void runAction(() => accountingPeriodsService.unlock(period.id));
                          }}
                        >
                          <Unlock className="size-3.5" />
                          {t("accounting.periods.actions.unlock")}
                        </EnterpriseButton>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </EnterpriseModal>
  );
}
