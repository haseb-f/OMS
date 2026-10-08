"use client";

import { OrderEntryFlow, useOrderEntryFlow } from "@/components/order-entry/order-entry-flow";
import {
  useCompanyOrderEntry,
  type StoreOrderCreatePrefillCustomer,
} from "@/components/order-entry/company/use-company-order-entry";
import type { StoreOrderRow } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";

export type { StoreOrderCreatePrefillCustomer };

/**
 * "New Store Order" — the company adapter of the one order-entry flow
 * (R15 D15-19): the same four steps agent users and staff entering an agent
 * order walk, in a dialog (a bottom sheet on phones).
 */
export function StoreOrderCreateDialog({
  open,
  onOpenChange,
  onCreated,
  prefillCustomer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (order: StoreOrderRow) => void;
  /** Set when opened from the Global Lookup dialog's "Add New Order" action — reuses this Customer instead of prompting for one. */
  prefillCustomer?: StoreOrderCreatePrefillCustomer | null;
}) {
  const { t } = useLocale();
  const flow = useOrderEntryFlow(open);
  const adapter = useCompanyOrderEntry({ open, onOpenChange, onCreated, prefillCustomer, flow });
  return (
    <OrderEntryFlow
      flow={flow}
      adapter={adapter}
      container="dialog"
      open={open}
      onOpenChange={onOpenChange}
      title={t("storeOrders.createDialog.title")}
      description={t("storeOrders.createDialog.description")}
      testId="store-order-create-dialog"
    />
  );
}
