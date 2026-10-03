"use client";

import { LayoutGrid, Table2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/providers/locale-provider";
import type { TableViewValue } from "./table-preferences";

/**
 * Table / Grid switch of a list. The same records, filters, sort, page and
 * selection feed both views — this only changes the presentation, so it is a
 * segmented control (switching a view), never a navigation.
 */
export function EnterpriseTableViewToggle({
  view,
  onViewChange,
}: {
  view: TableViewValue;
  onViewChange: (view: TableViewValue) => void;
}) {
  const { t } = useLocale();
  const items = [
    { value: "table", label: t("tableViews.view.table"), icon: Table2 },
    { value: "grid", label: t("tableViews.view.grid"), icon: LayoutGrid },
  ] as const;

  return (
    <ToggleGroup
      type="single"
      value={view}
      // Radix emits "" when the pressed item is pressed again — a list always has a view.
      onValueChange={(value) => {
        if (value === "table" || value === "grid") onViewChange(value);
      }}
      aria-label={t("tableViews.view.label")}
      data-view-toggle=""
    >
      {items.map((item) => (
        <Tooltip key={item.value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={item.value}
              size="icon-sm"
              aria-label={item.label}
              data-view={item.value}
            >
              <item.icon className="size-4" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="top">{item.label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
