"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardDescription,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { StackedCell } from "@/components/shared/stacked-cell";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { DeleteConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { formatDateRange } from "@/lib/date";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { fxOverridesService, type FxOverrideRow } from "@/services/fx-service";
import { FxOverrideDialog } from "./fx-override-dialog";
import { formatFxRate } from "./fx-format";

/** Active dated overrides, filterable by currency; add (range dialog) and soft-delete with a reason. */
export function FxOverridesCard({
  canManage,
  baseCurrencyId,
  baseCode,
  onChanged,
}: {
  canManage: boolean;
  baseCurrencyId: string | null;
  baseCode: string;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const [currencyId, setCurrencyId] = useState("");
  const [rows, setRows] = useState<FxOverrideRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<FxOverrideRow | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fxOverridesService.list(currencyId || undefined));
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    }
  }, [currencyId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const pairOf = (row: FxOverrideRow) =>
    `${row.fromCurrency?.code ?? ""}/${row.toCurrency?.code ?? baseCode}`;

  const confirmDelete = async () => {
    if (!deleting || deleteReason.trim().length < 3) return;
    setBusy(true);
    try {
      await fxOverridesService.remove(deleting.id, deleteReason.trim());
      toast.success(t("fxSettings.overrides.deleted"));
      setDeleting(null);
      await load();
      onChanged?.();
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const columns: CompactDetailColumn<FxOverrideRow>[] = [
    {
      id: "pair",
      header: t("fxSettings.overrides.range"),
      cell: (row) => (
        <StackedCell
          primary={
            <span>
              <span className="font-medium">{row.fromCurrency?.code}</span>{" "}
              <span className="num">
                {formatDateRange(row.dateFrom.slice(0, 10), row.dateTo.slice(0, 10))}
              </span>
            </span>
          }
          secondary={row.reason ?? undefined}
        />
      ),
    },
    {
      id: "rate",
      header: t("fxSettings.overrides.rate"),
      align: "end",
      cell: (row) => (
        <span className="num">
          {`1 ${row.fromCurrency?.code ?? ""} = ${formatFxRate(row.rate)} ${row.toCurrency?.code ?? baseCode}`}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (row: FxOverrideRow) => (
              <IconActionButton
                label={t("fxSettings.overrides.delete")}
                onClick={() => {
                  setDeleteReason("");
                  setDeleting(row);
                }}
              >
                <Trash2 />
              </IconActionButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <EnterpriseCard className="gap-0 py-3" data-testid="fx-overrides">
      <EnterpriseCardHeader className="flex flex-wrap items-start justify-between gap-2 px-4 pb-2">
        <div className="min-w-0">
          <EnterpriseCardTitle>{t("fxSettings.overrides.title")}</EnterpriseCardTitle>
          <EnterpriseCardDescription>
            {t("fxSettings.overrides.description")}
          </EnterpriseCardDescription>
        </div>
        {canManage ? (
          <EnterpriseButton type="button" size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            {t("fxSettings.overrides.add")}
          </EnterpriseButton>
        ) : null}
      </EnterpriseCardHeader>
      <EnterpriseCardContent className="flex flex-col gap-2 px-4">
        <div className="w-full sm:max-w-64">
          <CurrencyPicker
            valueKey="id"
            value={currencyId}
            allowClear
            placeholder={t("fxSettings.overrides.allCurrencies")}
            aria-label={t("fxSettings.overrides.currency")}
            onValueChange={setCurrencyId}
          />
        </div>
        <CompactDetailTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={t("fxSettings.overrides.empty")}
        />
      </EnterpriseCardContent>

      <FxOverrideDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        baseCurrencyId={baseCurrencyId}
        baseCode={baseCode}
        defaultCurrencyId={currencyId || undefined}
        onSaved={async () => {
          await load();
          onChanged?.();
        }}
      />

      <DeleteConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("fxSettings.overrides.deleteTitle")}
        description={
          deleting
            ? t("fxSettings.overrides.deleteDescription", {
                pair: pairOf(deleting),
                range: formatDateRange(
                  deleting.dateFrom.slice(0, 10),
                  deleting.dateTo.slice(0, 10),
                ),
              })
            : undefined
        }
        extra={
          <div className="flex flex-col gap-1.5 px-6">
            <Label htmlFor="fx-override-delete-reason">
              {t("fxSettings.overrides.deleteReason")}
            </Label>
            <Textarea
              id="fx-override-delete-reason"
              rows={2}
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
            />
          </div>
        }
        confirmLabel={t("fxSettings.overrides.delete")}
        confirmDisabled={deleteReason.trim().length < 3}
        isConfirming={busy}
        onConfirm={() => void confirmDelete()}
      />
    </EnterpriseCard>
  );
}
