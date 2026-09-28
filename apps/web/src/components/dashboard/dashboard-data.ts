"use client";

import { useCallback, useEffect, useState } from "react";
import { paymentsReviewService } from "@/services/payments-review-service";
import { bankTransactionsService } from "@/services/bank-transactions-service";

export type LoadState<T> =
  { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

/** One async figure set with an explicit error state (never a silent "—") and retry. */
export function useLoad<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", data: await loader() });
    } catch {
      setState({ status: "error" });
    }
  }, [loader]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  return { state, retry: load };
}

export interface PendingFigures {
  paymentReview: number | null;
  bank: { unmatched: number; review: number } | null;
}

/** Payment review queue + bank matching queues, each only when the user may see it. */
export async function loadPendingFigures(
  showPaymentReview: boolean,
  showBank: boolean,
): Promise<PendingFigures> {
  const [pending, matched, bankCounts] = await Promise.all([
    showPaymentReview
      ? paymentsReviewService.list({ status: "PENDING", page: 1, pageSize: 1 })
      : null,
    showPaymentReview
      ? paymentsReviewService.list({ status: "MATCHED", page: 1, pageSize: 1 })
      : null,
    showBank ? bankTransactionsService.statusCounts() : null,
  ]);
  return {
    // The review queue's default view is exactly PENDING + MATCHED.
    paymentReview: pending && matched ? pending.total + matched.total : null,
    bank: bankCounts
      ? {
          unmatched: bankCounts.UNMATCHED ?? 0,
          review:
            (bankCounts.MANUAL_REVIEW ?? 0) +
            (bankCounts.CONFLICT ?? 0) +
            (bankCounts.POTENTIAL ?? 0),
        }
      : null,
  };
}
