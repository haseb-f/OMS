"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { DetailFieldRow } from "@/components/shared/detail-workspace";
import { MoneyValue } from "@/components/shared/money-value";
import {
  assemblyBlockerMessage,
  summarizeAssemblyPreview,
  type PreviewLineView,
} from "@/config/inventory/assembly";
import { formatAmount } from "@/lib/money";
import { formatNumber } from "@/lib/format-number";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import type { AssemblyPreview } from "@/services/assembly-service";

export type AssemblyPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: AssemblyPreview };

/**
 * Live preview of an assembly (`GET /assembly/preview`): each component's need
 * vs what is available in the warehouse, the limiting component, the maximum
 * quantity possible now, the estimated cost (only when the API returns cost
 * figures) and the blockers — the same blockers `POST /assembly` enforces.
 */
export function AssemblyPreviewPanel({
  state,
  requestedQuantity,
  onUseMaximum,
}: {
  state: AssemblyPreviewState;
  requestedQuantity: number | null;
  onUseMaximum: (quantity: number) => void;
}) {
  const { t } = useLocale();

  if (state.status === "idle") {
    return <p className="text-caption text-muted-foreground">{t("assembly.dialog.previewHint")}</p>;
  }
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-1" aria-busy="true">
        <span className="sr-only">{t("assembly.dialog.previewLoading")}</span>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <Alert tone="destructive">
        <AlertTriangle />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  const { preview } = state;
  const summary = summarizeAssemblyPreview(preview);
  const showCost = preview.lines.some((line) => line.unitCost !== null);
  const quantityCell = (value: number) => (
    <span dir="ltr" className="num">
      {formatNumber(value)}
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">
          {preview.recipe ? t("assembly.versionLabel", { version: preview.recipe.version }) : null}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          {t("assembly.dialog.maximum", { count: formatNumber(preview.maximumQuantity) })}
          {preview.maximumQuantity > 0 && preview.maximumQuantity !== requestedQuantity ? (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => onUseMaximum(preview.maximumQuantity)}
            >
              {t("assembly.dialog.useMaximum")}
            </EnterpriseButton>
          ) : null}
        </span>
      </div>

      {summary.lines.length > 0 ? (
        <CompactDetailTable<PreviewLineView>
          stacked
          rows={summary.lines}
          rowKey={(line) => line.componentProductId}
          columns={[
            {
              id: "component",
              header: t("assembly.fields.component"),
              cell: (line) => (
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 truncate">{line.name}</span>
                  {line.isLimiting ? (
                    <EnterpriseBadge variant={line.shortage > 0 ? "destructive" : "warning"}>
                      {t("assembly.dialog.limiting")}
                    </EnterpriseBadge>
                  ) : null}
                </span>
              ),
            },
            {
              id: "needed",
              header: t("assembly.fields.needed"),
              align: "end",
              cell: (line) => quantityCell(line.needed),
            },
            {
              id: "available",
              header: t("assembly.fields.available"),
              align: "end",
              cell: (line) => (
                <span className="flex flex-col items-end">
                  <span className={cn(line.shortage > 0 && "font-semibold text-destructive")}>
                    {quantityCell(line.available)}
                  </span>
                  {line.shortage > 0 ? (
                    <span className="text-caption text-destructive">
                      {t("assembly.dialog.shortBy", { count: formatNumber(line.shortage) })}
                    </span>
                  ) : null}
                </span>
              ),
            },
            ...(showCost
              ? [
                  {
                    id: "unitCost",
                    header: t("assembly.fields.unitCost"),
                    align: "end" as const,
                    cell: (line: PreviewLineView) =>
                      line.unitCost === null ? (
                        "—"
                      ) : (
                        <span dir="ltr" className="num">
                          {formatAmount(line.unitCost, { decimals: 4 })}
                        </span>
                      ),
                  },
                  {
                    id: "value",
                    header: t("assembly.fields.value"),
                    align: "end" as const,
                    cell: (line: PreviewLineView) =>
                      line.value === null ? "—" : <MoneyValue value={line.value} />,
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {preview.blockers.length > 0 ? (
        <Alert tone="destructive">
          <AlertTriangle />
          <AlertDescription>
            <span className="font-medium">{t("assembly.dialog.blockersTitle")}</span>
            <ul className="mt-1 list-disc ps-4">
              {preview.blockers.map((blocker) => (
                <li key={`${blocker.code}:${blocker.message}`}>
                  {assemblyBlockerMessage(blocker, t)}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {preview.estimatedUnitCost !== null ? (
        <div className="flex flex-col gap-1 rounded-sm border border-border bg-surface-sunken px-3 py-2">
          <dl className="flex flex-col">
            <DetailFieldRow
              label={t("assembly.dialog.estimatedComponents")}
              value={
                preview.componentCost !== null ? (
                  <MoneyValue value={preview.componentCost} />
                ) : undefined
              }
            />
            <DetailFieldRow
              label={t("assembly.dialog.estimatedDirect")}
              value={
                preview.directCostEstimate !== null && Number(preview.directCostEstimate) > 0 ? (
                  <MoneyValue value={preview.directCostEstimate} />
                ) : undefined
              }
            />
            <DetailFieldRow
              label={t("assembly.dialog.estimatedUnitCost")}
              value={
                <span dir="ltr" className="num font-medium">
                  {formatAmount(preview.estimatedUnitCost, { decimals: 4 })}
                </span>
              }
            />
          </dl>
          <p className="text-caption text-muted-foreground">{t("assembly.dialog.estimateNote")}</p>
        </div>
      ) : null}
    </div>
  );
}
