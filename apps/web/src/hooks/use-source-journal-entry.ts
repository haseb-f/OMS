"use client";

import { useEffect, useState } from "react";
import { journalEntriesService } from "@/services/journal-entries-service";
import type { RelatedDocumentLink } from "@/components/shared/related-documents";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { useLocale } from "@/providers/locale-provider";

export type JournalTraceState = "idle" | "loading" | "found" | "missing";

/**
 * Canonical Journal ↔ Source Document lookup. Reads POSTED entries for the
 * given sourceType/sourceId. Callers that set `expected` can distinguish
 * "not posted yet" from "this document never posts a journal".
 */
export function useSourceJournalEntryLinks(
  sourceType: string,
  sourceId: string | null | undefined,
): RelatedDocumentLink[] {
  return useSourceJournalTrace(sourceType, sourceId).links;
}

export function useSourceJournalTrace(
  sourceType: string,
  sourceId: string | null | undefined,
): { links: RelatedDocumentLink[]; state: JournalTraceState } {
  const { t } = useLocale();
  const [links, setLinks] = useState<RelatedDocumentLink[]>([]);
  const [state, setState] = useState<JournalTraceState>(sourceId ? "loading" : "idle");

  useEffect(() => {
    if (!sourceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinks([]);
      setState("idle");
      return;
    }
    setState("loading");
    journalEntriesService
      .list({ sourceType, sourceId, status: "POSTED", pageSize: 5 })
      .then((result) => {
        const items = result.items;
        setLinks(
          items.map((entry) => ({
            id: entry.id,
            number: entry.entryNumber,
            href: `/finance/journal-entries/${entry.id}`,
            kind: "JOURNAL_ENTRY" as const,
            status: entry.status,
            statusLabel: t(JOURNAL_ENTRY_STATUS_LABEL_KEY[entry.status]),
            statusTone: JOURNAL_ENTRY_STATUS_TONE[entry.status],
          })),
        );
        setState(items.length > 0 ? "found" : "missing");
      })
      .catch(() => {
        setLinks([]);
        setState("missing");
      });
  }, [sourceType, sourceId, t]);

  return { links, state };
}
