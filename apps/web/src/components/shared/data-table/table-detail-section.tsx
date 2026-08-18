"use client";

import type { ReactNode } from "react";
import { SemanticValue } from "@/components/shared/semantic-value";
import { MoneyValue } from "@/components/shared/money-value";
import { TruncateText } from "@/components/shared/truncate-text";
import { EnterpriseButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINE_ITEM_PREVIEW = 4;

export function TableDetailSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-slot="table-detail-section" className={cn("min-w-0", className)}>
      <h3 className="mb-1.5 text-caption font-medium text-muted-foreground">{title}</h3>
      <div className="min-w-0 text-body">{children}</div>
    </section>
  );
}

export interface TableDetailLineItem {
  id: string;
  name: string | null;
  fallbackId?: string;
  quantity: number;
  unitPrice: string | number;
}

export function TableDetailLineItems({
  items,
  currency,
  emptyLabel,
  moreLabel,
  onShowMore,
  previewCount = LINE_ITEM_PREVIEW,
}: {
  items: TableDetailLineItem[];
  currency?: string | { code: string } | null;
  emptyLabel: string;
  moreLabel: (count: number) => string;
  onShowMore?: () => void;
  previewCount?: number;
}) {
  if (items.length === 0) {
    return <p className="text-caption text-muted-foreground">{emptyLabel}</p>;
  }

  const visible = items.slice(0, previewCount);
  const remaining = items.length - visible.length;

  return (
    <ul className="flex flex-col gap-1.5">
      {visible.map((item) => {
        const lineTotal = Number(item.unitPrice) * item.quantity;
        return (
          <li key={item.id} className="min-w-0">
            <div className="min-w-0">
              {item.name ? (
                <TruncateText className="font-medium text-foreground">{item.name}</TruncateText>
              ) : item.fallbackId ? (
                <SemanticValue kind="id" className="font-medium">
                  {item.fallbackId}
                </SemanticValue>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground">
              <SemanticValue kind="number">× {item.quantity}</SemanticValue>
              <MoneyValue value={item.unitPrice} currency={currency} className="font-normal" />
              {Number.isFinite(lineTotal) ? (
                <MoneyValue
                  value={lineTotal}
                  currency={currency}
                  className="font-medium text-foreground"
                />
              ) : null}
            </div>
          </li>
        );
      })}
      {remaining > 0 && onShowMore ? (
        <li>
          <EnterpriseButton
            type="button"
            variant="link"
            size="inline"
            className="text-caption"
            onClick={onShowMore}
          >
            {moreLabel(remaining)}
          </EnterpriseButton>
        </li>
      ) : remaining > 0 ? (
        <li className="text-caption text-muted-foreground">{moreLabel(remaining)}</li>
      ) : null}
    </ul>
  );
}

export function TableDetailStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="table-detail-stack" className={cn("flex flex-col gap-3", className)}>
      {children}
    </div>
  );
}
