import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import { documentPrintBranding } from "@/components/print/print-brand";
import type { JournalEntryRow } from "@/services/journal-entries-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** Journal voucher print — portrait, its own account / description / debit / credit layout (`ledger`), never invoice columns. */
export function buildJournalEntryPrintPayload(
  entry: JournalEntryRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "journal-voucher",
    documentNumber: entry.entryNumber,
    documentDate: formatDate(entry.entryDate),
    currency: "",
    company: {
      name: companyName,
      addressLines: [],
      branding: documentPrintBranding(companyLogoUrl),
    },
    party: {
      name: "",
      addressLines: [],
    },
    meta: [
      {
        label: t("accounting.journalEntries.fields.status"),
        value: t(`accounting.journalEntries.status.${entry.status.toLowerCase()}` as MessageKey),
      },
      ...(entry.reversalOfEntry
        ? [
            {
              label: t("accounting.journalEntries.fields.reversalOf"),
              value: entry.reversalOfEntry.entryNumber,
            },
          ]
        : []),
    ],
    // Lines render through the voucher's own ledger table (see `ledger` below).
    lineItems: [],
    totals: [],
    notes: entry.description ?? undefined,
    signatures: [
      { label: t("printDocument.preparedBy") },
      { label: t("printDocument.approvedBy") },
    ],
  };

  return {
    variant: "voucher",
    title: t("printDocument.docTitle.journalVoucher"),
    printedByName,
    recordPath: `/finance/journal-entries/${entry.id}`,
    data,
    ledger: {
      lines: entry.lines.map((line) => ({
        account: line.account ? `${line.account.code} — ${line.account.name}` : "",
        description: line.description ?? undefined,
        debit: Number(line.debit),
        credit: Number(line.credit),
      })),
      totalDebit: Number(entry.totalDebit),
      totalCredit: Number(entry.totalCredit),
      labels: {
        account: t("accounting.journalEntries.lines.account"),
        description: t("accounting.journalEntries.lines.description"),
        debit: t("accounting.journalEntries.lines.debit"),
        credit: t("accounting.journalEntries.lines.credit"),
      },
    },
    labels: { notes: t("accounting.journalEntries.fields.description") },
  };
}
