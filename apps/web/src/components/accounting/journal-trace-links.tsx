"use client";

import { RelatedDocuments } from "@/components/shared/related-documents";
import { useSourceJournalTrace } from "@/hooks/use-source-journal-entry";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

/**
 * Shared "View Journal Entry" panel. `expected` means this document should
 * already have a JE (confirmed/posted). Missing is then shown explicitly;
 * not-applicable documents omit the group entirely.
 */
export function JournalTraceLinks({
  sourceType,
  sourceId,
  expected = false,
  labelKey = "accounting.journalEntries.fields.viewJournalEntry",
}: {
  sourceType: string;
  sourceId: string | null | undefined;
  expected?: boolean;
  labelKey?: MessageKey;
}) {
  const { t } = useLocale();
  const { links, state } = useSourceJournalTrace(sourceType, sourceId);
  if (!sourceId && !expected) return null;

  return (
    <RelatedDocuments
      groups={[
        {
          labelKey,
          links,
          emptyLabel:
            expected && state !== "loading" && links.length === 0
              ? t("accounting.journalEntries.missingJournal")
              : undefined,
        },
      ]}
    />
  );
}
