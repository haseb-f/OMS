"use client";

import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

export interface RelatedDocumentLink {
  id: string;
  number: string;
  href: string;
  statusLabel?: string;
  statusTone?: StatusTone;
}

export interface RelatedDocumentGroup {
  labelKey: MessageKey;
  links: RelatedDocumentLink[];
}

/**
 * TASK-050 — the ONE "related documents" panel every document editor
 * renders through (Sales/Purchase Invoice, Sales/Purchase Order, ...): a
 * document may point back to the document it was created from and forward
 * to every document created from it (Customer Receipts, Returns, ...).
 * Every reference is a real clickable link to that document's own editor —
 * never plain text. Groups with no links are omitted entirely; the whole
 * panel renders nothing if every group is empty.
 */
export function RelatedDocuments({ groups }: { groups: RelatedDocumentGroup[] }) {
  const { t } = useLocale();
  const nonEmpty = groups.filter((group) => group.links.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-caption">
      {nonEmpty.map((group) => (
        <div key={group.labelKey} className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{t(group.labelKey)}:</span>
          {group.links.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className="inline-flex items-center gap-1.5 rounded bg-card px-1.5 py-0.5 hover:underline"
            >
              <code dir="ltr" className="text-caption">
                {link.number}
              </code>
              {link.statusLabel && <StatusBadge label={link.statusLabel} tone={link.statusTone} />}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
