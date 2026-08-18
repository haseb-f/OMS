"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Star, Archive, CalendarRange, Lock, Unlock } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { StatusBadge } from "@/components/business/status-badge";
import type { StatusTone } from "@/components/business/status-badge";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue, RowActionsMenu } from "@/components/shared/data-table";
import { CreateFiscalYearDialog } from "./create-fiscal-year-dialog";
import { PeriodsDialog } from "./periods-dialog";
import {
  fiscalYearsService,
  type FiscalYearRow,
  type FiscalYearStatusValue,
} from "@/services/fiscal-years-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

const STATUS_TONE: Record<FiscalYearStatusValue, StatusTone> = {
  OPEN: "success",
  CLOSED: "warning",
};

const STATUS_LABEL_KEY: Record<FiscalYearStatusValue, MessageKey> = {
  OPEN: "accounting.fiscalYears.status.OPEN",
  CLOSED: "accounting.fiscalYears.status.CLOSED",
};

export default function FiscalPeriodsPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission("accounting.fiscal-years.manage");
  const [rows, setRows] = useState<FiscalYearRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [openPeriodsFor, setOpenPeriodsFor] = useState<FiscalYearRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FiscalYearRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await fiscalYearsService.list());
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Keeps the open Periods dialog in sync after a Close/Reopen/Lock action changes one of its rows.
  useEffect(() => {
    if (!openPeriodsFor) return;
    const refreshed = rows.find((row) => row.id === openPeriodsFor.id);
    if (refreshed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenPeriodsFor(refreshed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const columns = useMemo<ColumnDef<FiscalYearRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("accounting.fiscalYears.fields.name"),
        meta: { titleKey: "accounting.fiscalYears.fields.name" },
        accessorFn: (row) => row.name,
        cell: (info) => (
          <StackedCell
            primary={
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{info.getValue() as string}</span>
                {info.row.original.isDefault && (
                  <Star
                    className="size-3.5 fill-warning text-warning"
                    aria-label={t("accounting.fiscalYears.defaultBadge")}
                  />
                )}
              </div>
            }
            secondary={`${formatDate(info.row.original.startDate)} — ${formatDate(info.row.original.endDate)}`}
          />
        ),
      },
      {
        id: "startDate",
        header: t("accounting.fiscalYears.fields.startDate"),
        meta: { titleKey: "accounting.fiscalYears.fields.startDate", defaultHidden: true },
        accessorFn: (row) => formatDate(row.startDate),
      },
      {
        id: "endDate",
        header: t("accounting.fiscalYears.fields.endDate"),
        meta: { titleKey: "accounting.fiscalYears.fields.endDate", defaultHidden: true },
        accessorFn: (row) => formatDate(row.endDate),
      },
      {
        id: "periods",
        header: t("accounting.fiscalYears.fields.periods"),
        meta: { titleKey: "accounting.fiscalYears.fields.periods" },
        enableSorting: false,
        accessorFn: (row) => row.periods.length,
      },
      {
        id: "status",
        header: t("common.status"),
        meta: { titleKey: "common.status" },
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            label={t(STATUS_LABEL_KEY[row.original.status])}
            tone={STATUS_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "__actions",
        header: t("common.actions"),
        meta: { titleKey: "common.actions" },
        enableSorting: false,
        cell: ({ row }) => {
          const fiscalYear = row.original;
          const handleToggle = async () => {
            try {
              if (fiscalYear.status === "OPEN") {
                await fiscalYearsService.close(fiscalYear.id);
                toast.success(t("accounting.fiscalYears.toasts.closed"));
              } else {
                await fiscalYearsService.reopen(fiscalYear.id);
                toast.success(t("accounting.fiscalYears.toasts.reopened"));
              }
              void load();
            } catch (error) {
              toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
            }
          };
          const handleSetDefault = async () => {
            try {
              await fiscalYearsService.setDefault(fiscalYear.id);
              toast.success(t("accounting.fiscalYears.toasts.defaultSet"));
              void load();
            } catch (error) {
              toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
            }
          };
          return (
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  key: "periods",
                  label: t("common.view"),
                  icon: CalendarRange,
                  onSelect: () => setOpenPeriodsFor(fiscalYear),
                },
                {
                  key: "setDefault",
                  label: t("accounting.fiscalYears.actions.setDefault"),
                  icon: Star,
                  hidden: !canCreate || fiscalYear.isDefault,
                  onSelect: () => void handleSetDefault(),
                },
                {
                  key: "toggle",
                  label:
                    fiscalYear.status === "OPEN"
                      ? t("accounting.fiscalYears.actions.close")
                      : t("accounting.fiscalYears.actions.reopen"),
                  icon: fiscalYear.status === "OPEN" ? Lock : Unlock,
                  hidden: !canCreate,
                  onSelect: () => void handleToggle(),
                },
                {
                  key: "archive",
                  label: t("common.archive"),
                  icon: Archive,
                  hidden: !canCreate,
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => setArchiveTarget(fiscalYear),
                },
              ]}
            />
          );
        },
      },
    ],
    [t, load, canCreate],
  );

  const exportKeys = ["name", "startDate", "endDate", "periods", "status"];

  return (
    <PageWorkspace
      title={t("nav.financeFiscalPeriods")}
      description={t("accounting.fiscalYears.description")}
      actions={
        canCreate && (
          <EnterpriseButton type="button" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("accounting.fiscalYears.createTitle")}
          </EnterpriseButton>
        )
      }
    >
      <EnterpriseDataTable
        tableId="finance-fiscal-years"
        printTitle={t("nav.financeFiscalPeriods")}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) =>
          exportRowsToCsv(
            rows.map((row) =>
              Object.fromEntries(columns.map((c) => [c.id!, getColumnDisplayValue(c, row)])),
            ),
            keys,
            "fiscal-years.csv",
          )
        }
      />

      <CreateFiscalYearDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void load();
        }}
      />

      <PeriodsDialog
        fiscalYear={openPeriodsFor}
        onOpenChange={(open) => !open && setOpenPeriodsFor(null)}
        onChanged={() => void load()}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={
          archiveTarget && `${archiveTarget.name} — ${t("common.confirmArchiveDescription")}`
        }
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          if (!archiveTarget) return;
          try {
            await fiscalYearsService.archive(archiveTarget.id);
            toast.success(t("common.archive"));
            void load();
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
          } finally {
            setArchiveTarget(null);
          }
        }}
      />
    </PageWorkspace>
  );
}
