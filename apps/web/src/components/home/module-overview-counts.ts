"use client";

import { useEffect, useState } from "react";
import { assemblyService } from "@/services/assembly-service";
import { employeesService } from "@/services/employees-service";
import { leadsService } from "@/services/leads-service";
import { productsService } from "@/services/products-service";
import { purchaseOrdersService } from "@/services/purchase-orders-service";
import { salesInvoicesService } from "@/services/sales-invoices-service";
import { salesOrdersService } from "@/services/sales-orders-service";
import { salesQuotationsService } from "@/services/sales-quotations-service";
import { storeOrdersService } from "@/services/store-orders-service";

const ONE_ROW = { page: 1, pageSize: 1 } as const;

/**
 * Destinations whose list endpoint reports a total, keyed by navigation id. The
 * figure is the destination's own list total from its own endpoint, so it is
 * exactly what the list would show this user: the API applies the same
 * permission guard and record scope (a sales user's own leads, never the
 * company's). A destination without an entry here shows no figure.
 */
export const DESTINATION_COUNT_SOURCES: Readonly<Record<string, () => Promise<number>>> = {
  "crm-leads": async () => (await leadsService.list(ONE_ROW)).total,
  "sales-quotations": async () => (await salesQuotationsService.list(ONE_ROW)).total,
  "sales-orders": async () => (await salesOrdersService.list(ONE_ROW)).total,
  "store-orders-list": async () => (await storeOrdersService.list(ONE_ROW)).total,
  "sales-invoices": async () => (await salesInvoicesService.list(ONE_ROW)).total,
  "purchasing-orders": async () => (await purchaseOrdersService.list(ONE_ROW)).total,
  "products-list": async () => (await productsService.list(ONE_ROW)).total,
  "hr-employees": async () => (await employeesService.list(ONE_ROW)).total,
  "inventory-assembly": async () => (await assemblyService.list(ONE_ROW)).total,
};

/**
 * Loads the figure for each listed destination that has a source. A request that
 * fails (no access to the data, offline) simply yields no figure — nothing is
 * guessed, nothing is shown as zero.
 */
export function useDestinationCounts(ids: readonly string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = ids.join("|");
  useEffect(() => {
    let cancelled = false;
    for (const id of key ? key.split("|") : []) {
      const load = DESTINATION_COUNT_SOURCES[id];
      if (!load) continue;
      load()
        .then((total) => {
          if (!cancelled && Number.isFinite(total)) setCounts((prev) => ({ ...prev, [id]: total }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return counts;
}
