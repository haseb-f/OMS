"use client";

import type { ReactNode } from "react";
import { SemanticValue } from "@/components/shared/semantic-value";
import { MoneyValue } from "@/components/shared/money-value";
import { TruncateText } from "@/components/shared/truncate-text";
import { EnterpriseButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINE_ITEM_PREVIEW = 4;

function hasCompactValue(value: ReactNode): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string" && (value.trim() === "" || value.trim() === "—")) return false;
  return true;
}

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

/** Compact primary + optional secondary — never a third data line, never a fake dash. */
export function TableDetailField({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  if (!hasCompactValue(primary) && !hasCompactValue(secondary)) return null;
  return (
    <div data-slot="table-detail-field" className="min-w-0">
      {hasCompactValue(primary) ? (
        <div className="min-w-0 font-medium text-foreground">{primary}</div>
      ) : null}
      {hasCompactValue(secondary) ? (
        <div className="mt-0.5 min-w-0 text-caption text-muted-foreground">{secondary}</div>
      ) : null}
    </div>
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
        const name = item.name?.trim() || null;
        return (
          <li key={item.id} className="min-w-0">
            <TableDetailField
              primary={
                name ? (
                  <TruncateText className="font-medium text-foreground">{name}</TruncateText>
                ) : item.fallbackId ? (
                  <SemanticValue kind="id" className="font-medium">
                    {item.fallbackId}
                  </SemanticValue>
                ) : null
              }
              secondary={
                <span dir="ltr" className="inline-flex flex-wrap items-baseline gap-x-1">
                  <SemanticValue kind="number">{item.quantity}</SemanticValue>
                  <span> × </span>
                  <MoneyValue value={item.unitPrice} currency={currency} className="font-normal" />
                </span>
              }
            />
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
