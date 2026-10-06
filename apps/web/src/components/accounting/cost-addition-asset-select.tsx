"use client";

import { useEffect, useState } from "react";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { fixedAssetsService, type CostAdditionTarget } from "@/services/fixed-assets-service";
import { useLocale } from "@/providers/locale-provider";
import { formatMoney } from "@/lib/money";

/** The existing asset a purchase invoice FIXED_ASSET line adds its cost to (R13b, O-2). */
export interface LinkedFixedAssetRef {
  id: string;
  code: string | null;
  name: string;
  status?: string | null;
}

export function linkedAssetLabel(asset: LinkedFixedAssetRef): string {
  return [asset.code, asset.name].filter(Boolean).join(" — ");
}

/**
 * "Add to existing asset" — Draft / Capitalized assets that can still absorb
 * a cost (`GET /fixed-assets/cost-addition-targets`). Empty = the line
 * creates a new asset (the default). Loaded when the line options open.
 */
export function CostAdditionAssetSelect({
  value,
  onChange,
  disabled,
  id,
}: {
  value: LinkedFixedAssetRef | null | undefined;
  onChange: (asset: LinkedFixedAssetRef | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useLocale();
  const [targets, setTargets] = useState<CostAdditionTarget[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fixedAssetsService
      .costAdditionTargets()
      .then((rows) => {
        if (!cancelled) setTargets(rows);
      })
      .catch(() => {
        if (!cancelled) setTargets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SearchableSelect
      id={id}
      value={value?.id ?? ""}
      onValueChange={(assetId) => {
        const target = targets?.find((row) => row.id === assetId);
        onChange(
          target
            ? { id: target.id, code: target.code, name: target.name, status: target.status }
            : null,
        );
      }}
      allowClear
      disabled={disabled}
      loading={targets === null}
      selectedLabel={value ? linkedAssetLabel(value) : undefined}
      options={(targets ?? []).map((target) => ({
        value: target.id,
        label: linkedAssetLabel(target),
        description: `${t(`accounting.lifecycleStatus.${target.status}`)} · ${formatMoney(target.cost)}`,
      }))}
      placeholder={t("assetSchedules.dialogs.addToAssetPlaceholder")}
      emptyText={t("assetSchedules.dialogs.noCostAdditionTargets")}
      aria-label={t("assetSchedules.actions.addToExistingAsset")}
    />
  );
}
