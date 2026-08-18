"use client";

import { ChevronRight, Eye } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EnterpriseButton } from "@/components/ui/button";
import { RowActionsMenu } from "@/components/shared/data-table";
import { StoreOrderDetailStack } from "@/components/store-orders/store-order-expanded-detail";
import { useUserContext } from "@/providers/user-context";
import {
  StoreOrderCustomerCell,
  StoreOrderDateCell,
  StoreOrderIdentityCell,
  StoreOrderPaymentCell,
  StoreOrderShippingCell,
} from "@/components/store-orders/store-order-row-cells";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { StoreOrderRow } from "@/services/store-orders-service";

/** Compact order card for narrow table containers — same hierarchy as the two-line desktop row. */
export function StoreOrderMobileCard({
  order,
  selected,
  onToggleSelected,
  expanded,
  onToggleExpanded,
  onView,
}: {
  order: StoreOrderRow;
  selected: boolean;
  onToggleSelected: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onView: (row: StoreOrderRow) => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  return (
    <div className={cn("border-b border-border/70 last:border-b-0", selected && "bg-primary/5")}>
      <div className="flex items-start gap-2 px-4 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected()}
          aria-label={t("table.selectRow")}
          className="mt-1.5"
        />
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mt-0.5"
          aria-expanded={expanded}
          aria-controls={`table-detail-${order.id}`}
          aria-label={expanded ? t("common.collapse") : t("common.expand")}
          onClick={onToggleExpanded}
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-[170ms] ease-(--ease-standard) motion-reduce:transition-none",
              expanded ? "rotate-90" : "rtl:rotate-180",
            )}
          />
        </EnterpriseButton>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2.5">
          <StoreOrderIdentityCell order={order} />
          <StoreOrderCustomerCell order={order} />
          <StoreOrderDateCell order={order} />
          <StoreOrderPaymentCell order={order} />
          <StoreOrderShippingCell order={order} />
          <div className="flex items-center justify-end">
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  key: "view",
                  label: t("common.view"),
                  icon: Eye,
                  hidden: !hasPermission("store-orders.view"),
                  onSelect: () => onView(order),
                },
              ]}
            />
          </div>
        </div>
      </div>
      {expanded && (
        <div
          id={`table-detail-${order.id}`}
          className="border-t border-border/60 bg-muted/25 px-4 py-3"
        >
          <StoreOrderDetailStack order={order} t={t} onShowMore={() => onView(order)} />
        </div>
      )}
    </div>
  );
}
