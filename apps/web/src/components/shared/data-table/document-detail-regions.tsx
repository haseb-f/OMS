"use client";

import { TruncateText } from "@/components/shared/truncate-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import type { MessageKey } from "@/i18n/translate";
import type { TableDetailLineItem } from "./table-detail-section";
import { TableDetailField, TableDetailLineItems, TableDetailSection } from "./table-detail-section";
import type { TableDetailRegion } from "./table-detail-regions";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface DetailPartyRef {
  address?: string | null;
  city?: string | null;
  email?: string | null;
}

export function toDocumentLineItems(
  items: Array<{
    id: string;
    productId: string;
    product?: { name?: string | null } | null;
    description?: string | null;
    quantity: number;
    unitPrice: string | number;
  }>,
): TableDetailLineItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.product?.name ?? item.description ?? null,
    fallbackId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));
}

export function formatPartyAddress(party?: DetailPartyRef | null): string {
  return [party?.address, party?.city].filter(Boolean).join("، ");
}

export function documentDetailLabels(t: Translate, party: "customer" | "supplier") {
  return {
    items: t("table.lineItems"),
    party: party === "customer" ? t("table.customerDetails") : t("table.supplierDetails"),
    notes: t("table.notes"),
    empty: t("common.noDataAvailable"),
    more: (count: number) => t("table.showMore", { count }),
  };
}

export function buildDocumentDetailRegions({
  documentColumnId,
  documentEndColumnId,
  partyColumnId,
  notesColumnId,
  items,
  currency,
  party,
  notes,
  labels,
  onShowMore,
}: {
  documentColumnId: string;
  documentEndColumnId?: string;
  partyColumnId: string;
  notesColumnId?: string;
  items: TableDetailLineItem[];
  currency?: string | { code: string } | null;
  party?: DetailPartyRef | null;
  notes?: string | null;
  labels: {
    items: string;
    party: string;
    notes: string;
    empty: string;
    more: (count: number) => string;
  };
  onShowMore?: () => void;
}): TableDetailRegion[] {
  const regions: TableDetailRegion[] = [];
  const address = formatPartyAddress(party);
  const email = party?.email?.trim() || null;
  const notesText = notes?.trim() || null;

  if (items.length > 0) {
    regions.push({
      startColumnId: documentColumnId,
      endColumnId: documentEndColumnId,
      grow: "until-next-region",
      content: (
        <TableDetailSection title={labels.items}>
          <TableDetailLineItems
            items={items}
            currency={currency}
            emptyLabel={labels.empty}
            moreLabel={labels.more}
            onShowMore={onShowMore}
          />
        </TableDetailSection>
      ),
    });
  }

  if (address || email) {
    regions.push({
      startColumnId: partyColumnId,
      grow: "until-next-region",
      content: (
        <TableDetailSection title={labels.party}>
          <TableDetailField
            primary={
              address ? (
                <TruncateText className="font-medium">{address}</TruncateText>
              ) : email ? (
                <SemanticValue kind="email">{email}</SemanticValue>
              ) : undefined
            }
            secondary={
              address && email ? <SemanticValue kind="email">{email}</SemanticValue> : undefined
            }
          />
        </TableDetailSection>
      ),
    });
  }

  if (notesText && notesColumnId) {
    regions.push({
      startColumnId: notesColumnId,
      grow: "until-next-region",
      content: (
        <TableDetailSection title={labels.notes}>
          <TableDetailField primary={<TruncateText>{notesText}</TruncateText>} />
        </TableDetailSection>
      ),
    });
  }

  return regions;
}
