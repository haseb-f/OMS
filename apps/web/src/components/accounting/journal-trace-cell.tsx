"use client";

import { RelatedRecordLink } from "@/components/shared/record-preview";
import { useSourceJournalTrace } from "@/hooks/use-source-journal-entry";
import { useLocale } from "@/providers/locale-provider";

export function JournalTraceCell({
  sourceType,
  sourceId,
  expected = false,
}: {
  sourceType: string;
  sourceId: string | null | undefined;
  expected?: boolean;
}) {
  const { t } = useLocale();
  const { links, state } = useSourceJournalTrace(sourceType, sourceId);
  if (!expected && !sourceId) return <span className="text-muted-foreground">—</span>;
  if (state === "loading") return <span className="text-muted-foreground">…</span>;
  if (links[0]) {
    return (
      <RelatedRecordLink
        kind="JOURNAL_ENTRY"
        id={links[0].id}
        number={links[0].number}
        status={links[0].status}
        variant="inline"
      />
    );
  }
  if (expected) {
    return (
      <span className="text-warning-foreground">
        {t("accounting.journalEntries.missingJournal")}
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}
