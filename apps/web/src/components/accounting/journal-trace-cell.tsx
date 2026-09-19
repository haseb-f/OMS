"use client";

import Link from "next/link";
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
      <Link href={links[0].href} className="hover:underline">
        <code dir="ltr" className="text-caption">
          {links[0].number}
        </code>
      </Link>
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
