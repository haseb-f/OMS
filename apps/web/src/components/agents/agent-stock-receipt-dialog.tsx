"use client";

import { useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { IconActionButton } from "@/components/shared/icon-action-button";
import {
  DocumentLineTable,
  DocumentLineTableAddFooter,
  DocumentLineTableBody,
  DocumentLineTableCell,
  DocumentLineTableHead,
  DocumentLineTableHeader,
  DocumentLineTableRow,
  documentLineCellClass,
  documentLineHeadClass,
  documentLineNumericCellClass,
  documentLineNumericHeadClass,
} from "@/components/documents/document-line-table";
import { Input } from "@/components/ui/input";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { ProductPicker } from "@/components/business/product-picker";
import type { WarehouseRow } from "@/config/master-data/entities";
import type { ProductRow } from "@/services/products-service";
import {
  agentStockService,
  type AgentStockReceipt,
  type AgentStockReceiptKind,
} from "@/services/agent-stock-service";
import { agentOptionLabel, useAgentOptions } from "./agent-options";
import { FieldNote } from "./field-note";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { businessToday } from "@/lib/business-date";
import { toISODate } from "@/lib/date";
import { reportApiError, toast } from "@/lib/toast";

interface ReceiptLine {
  key: number;
  product: ProductRow | null;
  quantity: string;
}

let lineKeySeq = 0;
const emptyLine = (): ReceiptLine => ({ key: lineKeySeq++, product: null, quantity: "" });
const wholePositive = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
};

/**
 * R18 B — custody receipt of agent-owned goods (opening stock or a later
 * receipt): agent, type, warehouse, date, the agent's reference, notes and
 * one or more product / quantity lines. Quantities only — the form has no
 * cost, price or invoice field on purpose; the server posts non-valued
 * movements and never a journal entry. `agent` fixes the agent (agent page);
 * without it the user picks one (receipts page).
 */
export function AgentStockReceiptDialog({
  agent,
  onOpenChange,
  onReceived,
}: {
  agent?: { id: string; label: string };
  onOpenChange: (open: boolean) => void;
  onReceived: (receipt: AgentStockReceipt) => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const fieldId = useId();
  const { agents } = useAgentOptions();
  const canOpen = hasPermission("inventory.opening-stock.create");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [agentId, setAgentId] = useState(agent?.id ?? "");
  const [kind, setKind] = useState<AgentStockReceiptKind>("RECEIPT");
  const [warehouse, setWarehouse] = useState<WarehouseRow | null>(null);
  const [date, setDate] = useState<Date | null>(() => businessToday());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([emptyLine()]);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const required = t("agentStock.form.required");

  const agentOptions = useMemo(
    () =>
      agents
        .filter((row) => row.status === "ACTIVE")
        .map((row) => ({
          value: row.id,
          label: agentOptionLabel(row),
          searchText: row.agentNumber,
        })),
    [agents],
  );
  const kindOptions = (["RECEIPT", "OPENING"] as const)
    .filter((value) => value === "RECEIPT" || canOpen)
    .map((value) => ({ value, label: t(`agentStock.receipts.kind.${value}`) }));

  const updateLine = (key: number, patch: Partial<ReceiptLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const linesValid = lines.every((line) => line.product && wholePositive(line.quantity));
  const isValid = !!agentId && !!warehouse && !!date && linesValid;

  const submit = async () => {
    if (!isValid || !warehouse || !date) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      const receipt = await agentStockService.createReceipt({
        agentId,
        warehouseId: warehouse.id,
        kind,
        receiptDate: toISODate(date),
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        idempotencyKey,
        lines: lines.map((line) => ({
          productId: line.product!.id,
          quantity: Number(line.quantity),
        })),
      });
      toast.success(
        t("agentStock.form.success", {
          number: receipt.receiptNumber,
          quantity: receipt.totalQuantity,
        }),
      );
      onReceived(receipt);
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={t("agentStock.form.title")}
      description={agent?.label ?? t("agentStock.form.nonValued")}
      isDirty={!!(warehouse || reference || notes || lines.some((line) => line.product))}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitLabel={t("agentStock.form.submit")}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection
          title={t("agentStock.form.title")}
          description={agent ? t("agentStock.form.nonValued") : undefined}
        >
          {agent ? null : (
            <FormCardField
              required
              label={t("agentStock.form.agent")}
              htmlFor={`${fieldId}-agent`}
              message={<FieldNote error={showErrors && !agentId ? required : null} />}
            >
              <SearchableSelect
                id={`${fieldId}-agent`}
                value={agentId}
                onValueChange={(value) => {
                  setAgentId(value);
                  setLines([emptyLine()]);
                }}
                error={showErrors && !agentId}
                placeholder={t("agents.agreements.choose")}
                options={agentOptions}
              />
            </FormCardField>
          )}
          <FormCardRow>
            <FormCardField
              size="sm"
              required
              label={t("agentStock.form.kind")}
              htmlFor={`${fieldId}-kind`}
              message={<FieldNote hint={t(`agentStock.form.kindHint.${kind}`)} />}
            >
              <SearchableSelect
                id={`${fieldId}-kind`}
                value={kind}
                onValueChange={(value) => setKind(value as AgentStockReceiptKind)}
                options={kindOptions}
              />
            </FormCardField>
            <FormCardField
              size="md"
              required
              label={t("agentStock.form.warehouse")}
              htmlFor={`${fieldId}-warehouse`}
              message={<FieldNote error={showErrors && !warehouse ? required : null} />}
            >
              <WarehousePicker
                id={`${fieldId}-warehouse`}
                value={warehouse}
                onChange={setWarehouse}
                error={showErrors && !warehouse}
              />
            </FormCardField>
            <FormCardField
              size="sm"
              required
              label={t("agentStock.form.date")}
              htmlFor={`${fieldId}-date`}
              message={<FieldNote error={showErrors && !date ? required : null} />}
            >
              <EnterpriseDatePicker
                id={`${fieldId}-date`}
                value={date}
                onChange={setDate}
                aria-invalid={showErrors && !date}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardRow>
            <FormCardField
              size="md"
              label={t("agentStock.form.reference")}
              htmlFor={`${fieldId}-reference`}
            >
              <Input
                id={`${fieldId}-reference`}
                value={reference}
                maxLength={100}
                placeholder={t("agentStock.form.referencePlaceholder")}
                onChange={(event) => setReference(event.target.value)}
              />
            </FormCardField>
            <FormCardField
              size="md"
              label={t("agentStock.form.notes")}
              htmlFor={`${fieldId}-notes`}
            >
              <Input
                id={`${fieldId}-notes`}
                value={notes}
                maxLength={500}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
        </FormCardSection>

        <FormCardSection title={t("agentStock.form.lines")}>
          <DocumentLineTable
            minWidthClass="min-w-[480px]"
            footer={
              <DocumentLineTableAddFooter
                label={t("agentStock.form.addLine")}
                onClick={() => setLines((current) => [...current, emptyLine()])}
              />
            }
          >
            <colgroup>
              <col />
              <col className="w-(--width-control-quantity)" />
              <col className="w-(--width-control-actions)" />
            </colgroup>
            <DocumentLineTableHeader>
              <DocumentLineTableRow className="hover:bg-transparent">
                <DocumentLineTableHead className={documentLineHeadClass}>
                  {t("agentStock.form.product")}
                </DocumentLineTableHead>
                <DocumentLineTableHead
                  className={`${documentLineNumericHeadClass} w-(--width-control-quantity)`}
                >
                  {t("agentStock.form.quantity")}
                </DocumentLineTableHead>
                <DocumentLineTableHead
                  className={`${documentLineHeadClass} w-(--width-control-actions)`}
                />
              </DocumentLineTableRow>
            </DocumentLineTableHeader>
            <DocumentLineTableBody>
              {lines.map((line) => {
                const productMissing = showErrors && !line.product;
                const quantityInvalid = showErrors && !wholePositive(line.quantity);
                return (
                  <DocumentLineTableRow key={line.key} className="hover:bg-muted/40">
                    <DocumentLineTableCell className={`${documentLineCellClass} min-w-0`}>
                      <ProductPicker
                        embedded
                        className="min-w-0 w-full"
                        value={line.product}
                        onChange={(product) => updateLine(line.key, { product })}
                        inventoryOnly
                        allowCreate={false}
                        agentId={agentId || undefined}
                        disabled={!agentId}
                        emptyText={t("agentStock.form.noProducts")}
                        triggerProps={{
                          "aria-label": t("agentStock.form.product"),
                          "aria-invalid": productMissing || undefined,
                        }}
                      />
                    </DocumentLineTableCell>
                    <DocumentLineTableCell
                      className={`${documentLineNumericCellClass} w-(--width-control-quantity)`}
                    >
                      <Input
                        dir="ltr"
                        inputMode="numeric"
                        inputSize="compact-md"
                        className="px-2 text-end tabular-nums"
                        value={line.quantity}
                        aria-invalid={quantityInvalid || undefined}
                        title={quantityInvalid ? t("agentStock.form.quantityInvalid") : undefined}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        aria-label={t("agentStock.form.quantity")}
                      />
                    </DocumentLineTableCell>
                    <DocumentLineTableCell
                      className={`${documentLineCellClass} w-(--width-control-actions)`}
                    >
                      <IconActionButton
                        label={t("agentStock.form.remove")}
                        disabled={lines.length === 1}
                        onClick={() =>
                          setLines((current) => current.filter((row) => row.key !== line.key))
                        }
                      >
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </IconActionButton>
                    </DocumentLineTableCell>
                  </DocumentLineTableRow>
                );
              })}
            </DocumentLineTableBody>
          </DocumentLineTable>
          {showErrors && !linesValid ? (
            <FieldNote error={t("agentStock.form.quantityInvalid")} />
          ) : null}
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
