"use client";

import { WorkflowTracks } from "@/components/shared/workflow-tracker";
import {
  INVOICE_PAYMENT_STATUS_LABEL_KEY,
  INVOICE_PAYMENT_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { INVOICE_STATUS_LABEL_KEY, INVOICE_STATUS_TONE } from "@/config/sales/invoice-status";
import { useLocale } from "@/providers/locale-provider";
import type { InvoicePaymentStatusValue } from "@/services/financial-transactions-service";
import type { SalesDocumentStatusValue } from "@/services/sales-invoices-service";

interface TrackPosition<T extends string> {
  stages: readonly T[];
  /** Stages a record may skip — shown only while current or proven passed. */
  optional: readonly T[];
  current: T | null;
  currentComplete: boolean;
  /** Stages proven passed (explicit); otherwise every stage before `current`. */
  completed?: ReadonlySet<T>;
  stateCode: T | null;
  /** Submitted sits between Draft and Approved; Cancelled / Closed are terminal. */
  statePlacement?: "before" | "inline" | "after";
}

/**
 * Sales invoice document status (`SalesInvoice.status`), per the API:
 * manual invoices start DRAFT → (submit → PENDING_APPROVAL → approve →
 * APPROVED) → CONFIRMED, but Confirm is allowed straight from DRAFT
 * (implicit approval) and invoices generated from a store order are created
 * CONFIRMED. So only CONFIRMED is certain for a confirmed invoice; DRAFT and
 * APPROVED are optional and shown only when current or proven passed
 * (PENDING_APPROVAL / APPROVED / CANCELLED are only reachable from DRAFT).
 * PARTIALLY_DELIVERED / DELIVERED are confirmed invoices (same label as the
 * badge); CLOSED has no known path, so it is shown as a state only.
 */
export const INVOICE_DOCUMENT_STAGES = ["DRAFT", "APPROVED", "CONFIRMED"] as const;

export function invoiceDocumentTrack(
  status: SalesDocumentStatusValue,
): TrackPosition<SalesDocumentStatusValue> {
  const stages = INVOICE_DOCUMENT_STAGES;
  const optional: SalesDocumentStatusValue[] = ["DRAFT", "APPROVED"];
  const base = { stages, optional };
  switch (status) {
    case "DRAFT":
      return { ...base, current: status, currentComplete: false, stateCode: null };
    case "APPROVED":
      return {
        ...base,
        current: status,
        currentComplete: false,
        completed: new Set(["DRAFT"]),
        stateCode: null,
      };
    case "PENDING_APPROVAL":
    case "CANCELLED":
      return {
        ...base,
        current: "DRAFT",
        currentComplete: true,
        stateCode: status,
        statePlacement: status === "PENDING_APPROVAL" ? "inline" : "after",
      };
    case "CONFIRMED":
    case "PARTIALLY_DELIVERED":
    case "DELIVERED":
      return { ...base, current: "CONFIRMED", currentComplete: true, stateCode: null };
    default:
      return { ...base, current: null, currentComplete: false, stateCode: status };
  }
}

/**
 * Invoice payment status (server-computed from allocations): UNPAID →
 * (PARTIALLY_PAID, optional — a single allocation can pay in full) → PAID;
 * CANCELLED is terminal.
 */
export const INVOICE_PAYMENT_STAGES = ["UNPAID", "PARTIALLY_PAID", "PAID"] as const;

export function invoicePaymentTrack(
  status: InvoicePaymentStatusValue,
): TrackPosition<InvoicePaymentStatusValue> {
  const stages = INVOICE_PAYMENT_STAGES;
  const optional: InvoicePaymentStatusValue[] = ["PARTIALLY_PAID"];
  if (status === "CANCELLED") {
    return { stages, optional, current: null, currentComplete: false, stateCode: status };
  }
  return {
    stages,
    optional,
    current: status,
    currentComplete: status === "PAID",
    stateCode: null,
  };
}

/**
 * Round 3.1 pilot: the invoice's document workflow and its payment as two
 * separate read-only trackers (design-system §12.7).
 */
export function InvoiceWorkflowTracks({
  status,
  paymentStatus,
}: {
  status: SalesDocumentStatusValue;
  paymentStatus?: InvoicePaymentStatusValue | null;
}) {
  const { t } = useLocale();
  const doc = invoiceDocumentTrack(status);
  const payment = paymentStatus ? invoicePaymentTrack(paymentStatus) : null;

  return (
    <WorkflowTracks
      label={t("workflowTracker.group")}
      tracks={[
        {
          key: "document",
          label: t("workflowTracker.document"),
          stages: doc.stages.map((code) => ({
            key: code,
            label: t(INVOICE_STATUS_LABEL_KEY[code]),
            optional: doc.optional.includes(code),
          })),
          current: doc.current,
          completed: doc.completed,
          currentComplete: doc.currentComplete,
          state: doc.stateCode
            ? {
                label: t(INVOICE_STATUS_LABEL_KEY[doc.stateCode]),
                tone: INVOICE_STATUS_TONE[doc.stateCode],
                placement: doc.statePlacement,
              }
            : null,
        },
        ...(payment
          ? [
              {
                key: "payment",
                label: t("workflowTracker.payment"),
                stages: payment.stages.map((code) => ({
                  key: code,
                  optional: payment.optional.includes(code),
                  label: t(INVOICE_PAYMENT_STATUS_LABEL_KEY[code]),
                })),
                current: payment.current,
                currentComplete: payment.currentComplete,
                state: payment.stateCode
                  ? {
                      label: t(INVOICE_PAYMENT_STATUS_LABEL_KEY[payment.stateCode]),
                      tone: INVOICE_PAYMENT_STATUS_TONE[payment.stateCode],
                    }
                  : null,
              },
            ]
          : []),
      ]}
    />
  );
}
