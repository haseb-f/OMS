"use client";

import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { TraceKind } from "@/services/traceability-service";

export interface RelatedDocumentLink {
  id: string;
  number: string;
  href: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  /** When set, the link opens the shared record preview instead of navigating. */
  kind?: TraceKind;
  status?: string | null;
}

export interface RelatedDocumentGroup {
  labelKey: MessageKey;
  links: RelatedDocumentLink[];
  /** Shown when `links` is empty — distinguishes missing JE from not-applicable. */
  emptyLabel?: string;
}

/**
 * The ONE related-documents panel every document editor renders through.
 * Groups with no links are omitted unless `emptyLabel` is set.
 */
export function RelatedDocuments({ groups }: { groups: RelatedDocumentGroup[] }) {
  const { t } = useLocale();
  const visible = groups.filter((group) => group.links.length > 0 || Boolean(group.emptyLabel));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-caption">
      {visible.map((group) => (
        <div key={group.labelKey} className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{t(group.labelKey)}:</span>
          {group.links.length > 0 ? (
            group.links.map((link) =>
              link.kind ? (
                <RelatedRecordLink
                  key={link.id}
                  kind={link.kind}
                  id={link.id}
                  number={link.number}
                  status={link.status}
                  showKind={false}
                />
              ) : (
                <Link
                  key={link.id}
                  href={link.href}
                  className="inline-flex items-center gap-1.5 rounded bg-card px-1.5 py-0.5 hover:underline"
                >
                  <code dir="ltr" className="text-caption">
                    {link.number}
                  </code>
                  {link.statusLabel && (
                    <StatusBadge label={link.statusLabel} tone={link.statusTone} />
                  )}
                </Link>
              ),
            )
          ) : (
            <span className="text-warning-foreground">{group.emptyLabel}</span>
          )}
        </div>
      ))}
    </div>
  );
}
