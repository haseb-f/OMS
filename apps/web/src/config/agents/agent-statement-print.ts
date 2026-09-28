import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { PrintCompanyInfo, StatementPrintPayload } from "@/types/print-engine";
import type {
  AgentLedgerEntryType,
  AgentStatement,
  AgentStatementLine,
} from "@/services/agents-service";
import { isMemoLine, lineReference } from "./agent-finance";

/**
 * Agent statement → the shared account-statement print template
 * (specs/agents-fulfillment-partners §8). Balances are the server's running
 * balances; memo lines (money the agent collected itself) print with their
 * amount in the description and no debit/credit, so the balance never moves
 * on them.
 */
export function buildAgentStatementPrintPayload(
  statement: AgentStatement,
  options: {
    title: string;
    partyLabel: string;
    periodLabel: string;
    memoLabel: string;
    signNote: string;
    company: PrintCompanyInfo;
    printedByName: string | null;
    typeLabel: (type: AgentLedgerEntryType) => string;
    /** Localized line description (`agentLedgerDescription`); defaults to the stored text. */
    describe?: (line: AgentStatementLine) => string;
  },
): StatementPrintPayload {
  const currency = statement.currency?.code ?? statement.agent.currency?.code ?? "";
  return {
    variant: "account-statement",
    title: options.title,
    printedByName: options.printedByName,
    company: options.company,
    partyRole: "customer",
    partyLabel: options.partyLabel,
    party: {
      name: statement.agent.name,
      number: statement.agent.agentNumber,
      lines: statement.agent.legalName ? [statement.agent.legalName] : [],
    },
    period: options.periodLabel,
    currency,
    openingBalance: statement.openingBalance,
    movements: statement.lines.map((line) => {
      const type = options.typeLabel(line.entryType);
      const text = options.describe ? options.describe(line) : line.description;
      const base = text ? `${type} — ${text}` : type;
      return {
        date: formatDate(line.entryDate),
        reference: lineReference(line),
        description: isMemoLine(line)
          ? `${base} (${options.memoLabel}: ${formatMoney(line.memoAmount ?? 0)})`
          : base,
        debit: line.debit,
        credit: line.credit,
        balance: line.balance,
      };
    }),
    periodDebit: statement.totals.debit,
    periodCredit: statement.totals.credit,
    closingBalance: statement.closingBalance,
    recordPath: `/agents/${statement.agent.id}`,
    notes: [options.signNote],
    orientation: "landscape",
  };
}
