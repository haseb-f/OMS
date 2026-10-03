import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money";
import type { PrintCompanyInfo, StatementPrintPayload } from "@/types/print-engine";
import type {
  PortalEntryType,
  PortalStatementLine,
  PortalStatementPrintData,
} from "@/services/agent-portal-service";

/**
 * The most specific business reference of a statement line the agent can
 * recognise (order → payment → payout → return → settlement → entry no.).
 */
export function portalLineReference(
  line: Pick<PortalStatementLine, "references" | "entryNumber">,
): string {
  const refs = line.references;
  return (
    refs.orderNumber ??
    refs.paymentNumber ??
    refs.payoutNumber ??
    refs.returnNumber ??
    refs.settlementNumber ??
    line.entryNumber
  );
}

/** Portal page a statement line links to (order or payout detail), or null. */
export function portalLineHref(line: Pick<PortalStatementLine, "references">): string | null {
  if (line.references.storeOrderId) return `/agent/orders/${line.references.storeOrderId}`;
  if (line.references.payoutId) return `/agent/payouts/${line.references.payoutId}`;
  return null;
}

/**
 * Agent statement (`GET /agent-portal/statement/print-data`) → the shared
 * account-statement print template. Balances are the server's running
 * balances; memo lines (money the agent collected itself) keep their amount
 * in the description with no debit/credit, so the balance never moves on
 * them. Orientation follows the API's `document.orientation` (landscape).
 */
export function buildPortalStatementPrintPayload(
  data: PortalStatementPrintData,
  options: {
    title: string;
    partyLabel: string;
    periodLabel: string;
    memoLabel: string;
    signNote: string;
    company: PrintCompanyInfo;
    typeLabel: (type: PortalEntryType) => string;
    /** Localized line description (`agentLedgerDescription`); defaults to the stored text. */
    describe?: (line: PortalStatementLine) => string;
  },
): StatementPrintPayload {
  return {
    variant: "account-statement",
    title: options.title,
    printedByName: data.document.printedBy ?? null,
    company: options.company,
    partyRole: "supplier",
    partyLabel: options.partyLabel,
    party: {
      name: data.agent.name,
      number: data.agent.agentNumber,
      lines:
        data.agent.legalName && data.agent.legalName !== data.agent.name
          ? [data.agent.legalName]
          : [],
    },
    period: options.periodLabel,
    currency: data.currency?.code ?? "",
    openingBalance: data.openingBalance,
    movements: data.lines.map((line) => {
      const type = options.typeLabel(line.entryType);
      const text = options.describe ? options.describe(line) : line.description;
      const base = text ? `${type} — ${text}` : type;
      return {
        date: formatBusinessDate(line.entryDate),
        reference: portalLineReference(line),
        description: line.memo
          ? `${base} (${options.memoLabel}: ${formatMoney(line.memoAmount)})`
          : base,
        debit: line.debit,
        credit: line.credit,
        balance: line.balance,
      };
    }),
    periodDebit: data.totals.debit,
    periodCredit: data.totals.credit,
    closingBalance: data.closingBalance,
    recordPath: "/agent/statement",
    notes: [options.signNote],
    orientation: data.document.orientation,
  };
}
