import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { JournalEntryRow } from "@/services/journal-entries-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** Feeds the existing Print Engine's dedicated "voucher" variant/template (data.type "journal-voucher", pre-reserved) — no new template built. */
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
      branding: {
        logoUrl: companyLogoUrl,
        primaryColor: "#0F8A5F",
        secondaryColor: "#2563EB",
        paperSize: "a4-portrait",
        language: "rtl",
      },
    },
    party: {
      name: entry.description ?? "",
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
    lineItems: entry.lines.map((line) => ({
      id: line.id,
      description: [
        line.account ? `${line.account.code} — ${line.account.name}` : "",
        line.description,
      ]
        .filter(Boolean)
        .join(": "),
      quantity: 1,
      unitPrice: Number(line.debit),
      total: Number(line.credit),
    })),
    totals: [
      { label: t("accounting.journalEntries.lines.totalDebit"), value: Number(entry.totalDebit) },
      {
        label: t("accounting.journalEntries.lines.totalCredit"),
        value: Number(entry.totalCredit),
        emphasis: true,
      },
    ],
  };

  return {
    variant: "voucher",
    title: `${t("accounting.journalEntries.title")} — ${entry.entryNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("accounting.journalEntries.fields.number"),
      documentDate: t("accounting.journalEntries.fields.entryDate"),
      billTo: t("accounting.journalEntries.fields.description"),
      description: t("accounting.journalEntries.lines.account"),
      quantity: "",
      unitPrice: t("accounting.journalEntries.lines.debit"),
      lineTotal: t("accounting.journalEntries.lines.credit"),
      notes: t("accounting.journalEntries.fields.description"),
    },
  };
}
