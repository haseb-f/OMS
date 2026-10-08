"use client";

import { useId, useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { FieldNote } from "@/components/agents/field-note";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";
import { newIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  storeOrderMoneyService,
  type ReturnableLine,
  type StoreOrderReturnsOverview,
} from "./store-order-money-service";
import { buildReturnRequestLines } from "./store-order-money";

type Row = ReturnableLine & { invoiceNumber: string };

/**
 * "Return" (R15, D15-10): requests a return of the order's delivered
 * (invoiced) lines with a reason — a DRAFT credit note per invoice, no stock
 * movement and no posting until "Receive & inspect".
 */
export function StoreOrderReturnDialog({
  orderNumber,
  overview,
  onOpenChange,
  onRequested,
}: {
  orderNumber: string;
  overview: StoreOrderReturnsOverview;
  onOpenChange: (open: boolean) => void;
  onRequested: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  // One key per dialog open: a retry or double click requests one return.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const rows = useMemo<Row[]>(
    () =>
      overview.invoices.flatMap((invoice) =>
        invoice.lines
          .filter((line) => line.returnableQuantity > 0)
          .map((line) => ({ ...line, invoiceNumber: invoice.invoiceNumber })),
      ),
    [overview],
  );
  const { lines, errors } = buildReturnRequestLines(overview, quantities);
  const hasErrors = Object.keys(errors).length > 0;
  const reasonMissing = !reason.trim();

  const submit = async () => {
    if (hasErrors || lines.length === 0 || reasonMissing) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      const result = await storeOrderMoneyService.requestReturn(overview.storeOrderId, {
        reason: reason.trim(),
        lines,
        idempotencyKey,
      });
      reportSuccess(
        t("storeOrderMoney.returnDialog.requested", {
          numbers: result.returns.map((row) => row.returnNumber).join("، "),
        }),
      );
      onRequested();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const columns: CompactDetailColumn<Row>[] = [
    {
      id: "product",
      header: t("storeOrderMoney.returnDialog.product"),
      cell: (row) => (
        <span className="flex flex-col">
          <span>{row.name}</span>
          <span className="text-caption text-muted-foreground">
            <span dir="ltr">{row.sku}</span> · {row.invoiceNumber}
          </span>
        </span>
      ),
    },
    {
      id: "delivered",
      header: t("storeOrderMoney.returnDialog.delivered"),
      align: "end",
      cell: (row) => <SemanticValue kind="number">{row.invoicedQuantity}</SemanticValue>,
    },
    {
      id: "returned",
      header: t("storeOrderMoney.returnDialog.alreadyReturned"),
      align: "end",
      cell: (row) => <SemanticValue kind="number">{row.returnedQuantity}</SemanticValue>,
    },
    {
      id: "quantity",
      header: t("storeOrderMoney.returnDialog.quantity"),
      align: "end",
      cell: (row) => {
        const error = errors[row.salesInvoiceItemId];
        return (
          <div className="flex flex-col items-end gap-0.5">
            <Input
              dir="ltr"
              inputMode="numeric"
              className="w-20 text-end"
              aria-label={`${t("storeOrderMoney.returnDialog.quantity")} — ${row.name}`}
              value={quantities[row.salesInvoiceItemId] ?? ""}
              aria-invalid={!!error}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [row.salesInvoiceItemId]: event.target.value,
                }))
              }
            />
            {error ? (
              <span className="text-caption text-destructive">
                {error === "tooMany"
                  ? t("storeOrderMoney.returnDialog.tooMany", { max: row.returnableQuantity })
                  : t("storeOrderMoney.returnDialog.noLines")}
              </span>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      icon={PackageOpen}
      title={t("storeOrderMoney.returnDialog.title", { order: orderNumber })}
      description={t("storeOrderMoney.returnDialog.description")}
      isDirty={Object.values(quantities).some(Boolean) || !!reason}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitDisabled={rows.length === 0}
          submitLabel={t("storeOrderMoney.returnDialog.submit")}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("storeOrderMoney.returnDialog.invoice")}>
          <CompactDetailTable
            stacked
            columns={columns}
            rows={rows}
            rowKey={(row) => row.salesInvoiceItemId}
            empty={t("storeOrderMoney.returnDialog.nothingReturnable")}
          />
          {showErrors && lines.length === 0 && !hasErrors ? (
            <p className="text-caption text-destructive">
              {t("storeOrderMoney.returnDialog.noLines")}
            </p>
          ) : null}
        </FormCardSection>
        <FormCardSection title={t("storeOrderMoney.returnDialog.reason")}>
          <FormCardField
            required
            label={t("storeOrderMoney.returnDialog.reason")}
            htmlFor={`${fieldId}-reason`}
            message={
              <FieldNote
                error={
                  showErrors && reasonMissing
                    ? t("storeOrderMoney.returnDialog.reasonRequired")
                    : null
                }
              />
            }
          >
            <Textarea
              id={`${fieldId}-reason`}
              rows={2}
              maxLength={500}
              value={reason}
              aria-invalid={showErrors && reasonMissing}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
