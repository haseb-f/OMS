"use client";

import { useEffect, useState } from "react";
import { journalEntriesService } from "@/services/journal-entries-service";
import type { RelatedDocumentLink } from "@/components/shared/related-documents";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { useLocale } from "@/providers/locale-provider";

/**
 * TASK-054 (Related Documents Part 7) — "Journal ↔ Source Document" reverse
 * lookup every posted operational document's editor uses to show its own
 * auto-posted Journal Entry. Never creates or duplicates anything: reads the
 * one JournalEntry the Posting Engine already created for this
 * `sourceType`/`sourceId` via the existing `journalEntriesService.list`
 * filter (TASK-054 added `sourceType`/`sourceId` to that one query, nothing
 * else). Returns an empty array while loading, before posting, or if the
 * source has no id yet — `RelatedDocuments` already renders nothing for an
 * empty group.
 */
export function useSourceJournalEntryLinks(
  sourceType: string,
  sourceId: string | null | undefined,
): RelatedDocumentLink[] {
  const { t } = useLocale();
  const [links, setLinks] = useState<RelatedDocumentLink[]>([]);

  useEffect(() => {
    if (!sourceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinks([]);
      return;
    }
    journalEntriesService
      .list({ sourceType, sourceId, pageSize: 1 })
      .then((result) => {
        const entry = result.items[0];
        setLinks(
          entry
            ? [
                {
                  id: entry.id,
                  number: entry.entryNumber,
                  href: `/finance/journal-entries/${entry.id}`,
                  statusLabel: t(JOURNAL_ENTRY_STATUS_LABEL_KEY[entry.status]),
                  statusTone: JOURNAL_ENTRY_STATUS_TONE[entry.status],
                },
              ]
            : [],
        );
      })
      .catch(() => setLinks([]));
  }, [sourceType, sourceId, t]);

  return links;
}
