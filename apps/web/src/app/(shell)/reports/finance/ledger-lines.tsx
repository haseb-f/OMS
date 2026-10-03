"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type {
  FinancialReportColumn,
  FinancialReportLine,
  FinancialReportSummaryItem,
  FinancialReportTextColumn,
} from "@/components/accounting/financial-report";
import {
  isAdverseBalance,
  lineSideValues,
  type NormalSide,
} from "@/components/accounting/financial-report";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { RECORD_ROUTES } from "@/config/traceability/record-routes";
import { journalSourceHref, journalSourceLabelKey } from "@/config/accounting/journal-source";
import type { AccountLedgerMovement } from "@/services/accounting-reports-service";
import type { TraceKind } from "@/services/traceability-service";
import type { MessageKey } from "@/i18n/translate";
import { formatBusinessDate } from "@/components/accounting/financial-report/business-date";

/**
 * The ONE builder for ledger-style report rows — General Ledger, Account
 * Statement and Customer/Supplier Statement all render the same block:
 * opening balance → dated Journal Entry lines with running balance →
 * closing balance, with drill-down to the JE and its source document.
 */

type Translate = (key: MessageKey) => string;

export interface LedgerBlockInput {
  id: string;
  code?: string;
  label: string;
  labelEn?: string | null;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  movements: AccountLedgerMovement[];
  /**
   * The balance's nature (account type; customer = debit, supplier =
   * credit). A running/closing balance against it is red; unknown → no red.
   */
  normalSide?: NormalSide;
}

/**
 * Debit · Credit · Running balance — the balance is Debit − Credit: a credit
 * balance reads with a minus sign (the Debit/Credit columns name the side, so
 * no Dr/Cr suffix is repeated). Red only when the balance is abnormal for the
 * block's nature.
 */
export const LEDGER_COLUMNS: FinancialReportColumn[] = [
  { key: "debit", labelKey: "reports.finance.fields.debit" },
  { key: "credit", labelKey: "reports.finance.fields.credit" },
  {
    key: "balance",
    labelKey: "reports.finance.fields.runningBalance",
    emphasize: true,
    balance: true,
  },
];

/** Opening · Debit · Credit · Closing tiles of one ledger block (account / partner statement). */
export function ledgerSummaryItems(
  t: Translate,
  totals: Pick<
    LedgerBlockInput,
    "openingBalance" | "periodDebit" | "periodCredit" | "closingBalance"
  >,
  normalSide?: NormalSide,
): FinancialReportSummaryItem[] {
  return [
    {
      id: "openingBalance",
      label: t("reports.finance.fields.openingBalance"),
      value: totals.openingBalance,
      adverse: isAdverseBalance(totals.openingBalance, normalSide),
    },
    { id: "periodDebit", label: t("reports.finance.fields.debit"), value: totals.periodDebit },
    { id: "periodCredit", label: t("reports.finance.fields.credit"), value: totals.periodCredit },
    {
      id: "closingBalance",
      label: t("reports.finance.fields.closingBalance"),
      value: totals.closingBalance,
      emphasize: true,
      adverse: isAdverseBalance(totals.closingBalance, normalSide),
    },
  ];
}

export function movementLineId(blockId: string, movement: AccountLedgerMovement) {
  return `${blockId}:${movement.lineId}`;
}

function sourceText(t: Translate, movement: AccountLedgerMovement): string {
  const kind = t(journalSourceLabelKey(movement.sourceType));
  return movement.referenceNumber ? `${kind} ${movement.referenceNumber}` : kind;
}

/** A ledger block: expandable group (period debit/credit, closing) over opening / movements / closing rows. */
export function buildLedgerBlock(
  block: LedgerBlockInput,
  t: Translate,
  { showAccount = false }: { showAccount?: boolean } = {},
): FinancialReportLine {
  const children: FinancialReportLine[] = [
    {
      id: `${block.id}:opening`,
      parentId: block.id,
      kind: "opening",
      level: 1,
      normalSide: block.normalSide,
      label: t("reports.finance.fields.openingBalance"),
      expandable: false,
      // An opening balance has no period debit/credit — those cells do not
      // apply (blank), they are not a genuine zero.
      values: { balance: block.openingBalance },
      children: [],
    },
    ...block.movements.map((movement): FinancialReportLine => ({
      id: movementLineId(block.id, movement),
      parentId: block.id,
      kind: "posting",
      level: 1,
      normalSide: block.normalSide,
      code: showAccount ? movement.accountCode : undefined,
      label: movement.description ?? sourceText(t, movement),
      expandable: false,
      // One JE line uses one side; the other is not applicable (blank).
      values: {
        ...lineSideValues(movement.debit, movement.credit),
        balance: movement.runningBalance,
      },
      text: {
        date: formatBusinessDate(movement.entryDate),
        journal: movement.journal ? movement.journal.name : "",
        entry: movement.entryNumber,
        source: sourceText(t, movement),
        partner: movement.partner?.name ?? "",
      },
      children: [],
    })),
    {
      id: `${block.id}:closing`,
      parentId: block.id,
      kind: "closing",
      level: 1,
      normalSide: block.normalSide,
      label: t("reports.finance.fields.closingBalance"),
      expandable: false,
      values: {
        debit: block.periodDebit,
        credit: block.periodCredit,
        balance: block.closingBalance,
      },
      children: [],
    },
  ];
  return {
    id: block.id,
    parentId: null,
    kind: "group",
    level: 0,
    normalSide: block.normalSide,
    code: block.code,
    label: block.label,
    labelEn: block.labelEn ?? null,
    expandable: true,
    values: {
      debit: block.periodDebit,
      credit: block.periodCredit,
      balance: block.closingBalance,
    },
    children,
  };
}

function isTraceKind(sourceType: string | null): sourceType is TraceKind {
  return !!sourceType && sourceType in RECORD_ROUTES;
}

/** Stops the row's own click (drill-down) when a link inside it is used. */
function StopRowClick({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full" onClick={(event) => event.stopPropagation()}>
      {children}
    </span>
  );
}

/**
 * Date · Journal · Entry (JE preview) · Source document (preview / page) ·
 * Partner. `movements` resolves a row back to its Journal Entry line.
 */
export function ledgerTextColumns(
  movements: Map<string, AccountLedgerMovement>,
  { showPartner = true }: { showPartner?: boolean } = {},
): FinancialReportTextColumn[] {
  const columns: FinancialReportTextColumn[] = [
    { key: "date", labelKey: "reports.finance.fields.entryDate", width: 6.5 },
    {
      key: "journal",
      labelKey: "reports.finance.fields.journal",
      width: 7,
      // Lowest-value column (the entry number already identifies the line):
      // only on wide screens, so the account names keep their width.
      hideBelow: "2xl",
    },
    {
      key: "entry",
      labelKey: "reports.finance.fields.entryNumber",
      width: 8,
      render: (line) => {
        const movement = movements.get(line.id);
        if (!movement) return null;
        return (
          <StopRowClick>
            <RelatedRecordLink
              kind="JOURNAL_ENTRY"
              id={movement.journalEntryId}
              number={movement.entryNumber}
              status={movement.status}
              variant="inline"
            />
          </StopRowClick>
        );
      },
    },
    {
      key: "source",
      labelKey: "reports.finance.fields.sourceDocument",
      width: 11,
      hideBelow: "md",
      render: (line) => {
        const movement = movements.get(line.id);
        if (!movement) return null;
        const text = line.text?.source ?? "";
        if (isTraceKind(movement.sourceType) && movement.sourceId) {
          return (
            <StopRowClick>
              <RelatedRecordLink
                kind={movement.sourceType}
                id={movement.sourceId}
                number={movement.referenceNumber ?? text}
                variant="inline"
                showKind
              />
            </StopRowClick>
          );
        }
        const href = journalSourceHref(movement.sourceType, movement.sourceId);
        return href ? (
          <StopRowClick>
            <Link href={href} className="truncate text-primary hover:underline">
              {text}
            </Link>
          </StopRowClick>
        ) : (
          <span className="truncate text-muted-foreground">{text}</span>
        );
      },
    },
  ];
  if (showPartner) {
    columns.push({
      key: "partner",
      labelKey: "reports.finance.fields.partnerName",
      width: 9,
      // Wide screens only, so a 1440 desktop fits the ledger without scrolling.
      hideBelow: "2xl",
    });
  }
  return columns;
}

/** Row id → Journal Entry line, for the text-column drill-down renders. */
export function indexLedgerMovements(
  blocks: LedgerBlockInput[],
): Map<string, AccountLedgerMovement> {
  const index = new Map<string, AccountLedgerMovement>();
  for (const block of blocks) {
    for (const movement of block.movements) index.set(movementLineId(block.id, movement), movement);
  }
  return index;
}
