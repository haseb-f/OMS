"use client";

import { Check, Rows2, Rows4 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { TableDensityValue } from "./table-preferences";

/**
 * Row density of a table (compact / comfortable), as its own toolbar control —
 * not a Columns setting. The trigger icon always shows the CURRENT density
 * (tight rows = compact, airy rows = comfortable) and its accessible name /
 * tooltip spells it out, so the state reads without opening the menu.
 */
export function EnterpriseTableDensityControl({
  density,
  onDensityChange,
}: {
  density: TableDensityValue;
  onDensityChange: (density: TableDensityValue) => void;
}) {
  const { t } = useLocale();
  const options: { value: TableDensityValue; label: string; hint: string; icon: typeof Rows4 }[] = [
    {
      value: "compact",
      label: t("tableViews.density.compact"),
      hint: t("tableViews.density.compactHint"),
      icon: Rows4,
    },
    {
      value: "comfortable",
      label: t("tableViews.density.comfortable"),
      hint: t("tableViews.density.comfortableHint"),
      icon: Rows2,
    },
  ];
  const current = options.find((option) => option.value === density) ?? options[0];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconActionButton
          label={t("tableViews.density.current", { value: current.label })}
          data-density-control=""
          data-density={density}
        >
          <CurrentIcon className="size-4" />
        </IconActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("tableViews.density.label")}</DropdownMenuLabel>
        {options.map((option) => {
          const Icon = option.icon;
          const selected = option.value === density;
          return (
            <DropdownMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={selected}
              data-checked={selected || undefined}
              className={cn(selected && "bg-muted")}
              onSelect={() => onDensityChange(option.value)}
            >
              <Icon className="size-4" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{option.label}</span>
                <span className="text-caption text-muted-foreground">{option.hint}</span>
              </span>
              {selected ? <Check className="size-4 text-primary" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
