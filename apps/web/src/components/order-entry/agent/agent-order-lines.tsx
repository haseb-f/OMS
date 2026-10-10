"use client";

import { useMemo } from "react";
import { PackageOpen, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldMessage } from "@/components/ui/form";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { MoneyInput } from "@/components/shared/money-input";
import { MoneyValue } from "@/components/shared/money-value";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { localizedName } from "@/config/agent-portal/labels";
import {
  quoteIssueText,
  newAgentLine,
  type AgentLineDraft,
  type AgentLineError,
} from "@/config/orders/agent-order-entry";
import type { OrderQuote, PricingMode } from "@/services/agent-portal-service";
import { formatMoney } from "@/lib/money";
import { ltrIsolate } from "@/lib/bidi";
import { useLocale } from "@/providers/locale-provider";
import type { AgentEntryProduct } from "./agent-entry-source";

/**
 * The agent's product lines: a product from the agent's own catalog (with its
 * list price and available-to-sell), a whole quantity and — in "Shipping
 * added" — the agreed amount of the line; in "Shipping included" the server's
 * allocation is shown instead. Issues the quote reports for a line appear
 * under it. One row per line, stacked on phones (no horizontal scroll).
 */
export function AgentOrderLines({
  lines,
  onChange,
  products,
  available,
  pricingMode,
  errors,
  showErrors,
  quote,
  currency,
}: {
  lines: AgentLineDraft[];
  onChange: (lines: AgentLineDraft[]) => void;
  /** null while loading. */
  products: AgentEntryProduct[] | null;
  /** Available to sell per product (catalog or inventory API); null = unknown. */
  available: ReadonlyMap<string, number | null>;
  pricingMode: PricingMode;
  errors: AgentLineError[];
  showErrors: boolean;
  /** The current quote (its line amounts and per-line issues), or null. */
  quote: OrderQuote | null;
  currency: string | { code: string } | null;
}) {
  const { t, locale } = useLocale();
  const has = (error: AgentLineError) => showErrors && errors.includes(error);
  const options = useMemo(
    () =>
      (products ?? []).map((product) => ({
        value: product.id,
        label: localizedName(product, locale),
        description: product.sku,
        searchText: [product.name, product.nameEn, product.displayName, product.sku]
          .filter(Boolean)
          .join(" "),
      })),
    [products, locale],
  );
  const productById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );
  const setLine = (key: string, patch: Partial<AgentLineDraft>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const showAmount = pricingMode === "SHIPPING_ADDED";
  const currencyCode = typeof currency === "string" ? currency : (currency?.code ?? null);

  return (
    <div
      className="flex flex-col gap-2"
      data-field-name="lines"
      data-invalid={has("lines") || has("lineAmount") ? "true" : undefined}
    >
      {products && products.length === 0 ? (
        <Alert tone="info">
          <PackageOpen />
          <div className="flex flex-col gap-0.5">
            <AlertTitle>{t("agentPricing.emptyCatalog.title")}</AlertTitle>
            <AlertDescription>{t("agentPricing.emptyCatalog.agent")}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      <ul className="flex flex-col gap-2">
        {lines.map((line, index) => {
          const product = productById.get(line.productId);
          const productAvailable = line.productId ? available.get(line.productId) : null;
          const issues = (quote?.issues ?? []).filter((issue) => issue.lineKey === String(index));
          const amountMissing = has("lineAmount") && showAmount && !line.lineAmount.trim();
          const quotedAmount = quote?.lines[index]?.lineAmount;
          return (
            <li
              key={line.key}
              className="flex flex-col gap-2 rounded-md border border-border p-2 @md:grid @md:grid-cols-[minmax(0,1fr)_5.5rem_9rem_auto] @md:items-start"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <SearchableSelect
                  aria-label={t("agentPortal.orderForm.fields.product")}
                  value={line.productId}
                  onValueChange={(productId) => setLine(line.key, { productId })}
                  options={options}
                  loading={products === null}
                  placeholder={t("agentPortal.orderForm.chooseProduct")}
                  emptyText={t("agentPortal.orderForm.noProducts")}
                  error={has("lines") && !line.productId}
                />
                {product ? (
                  <span className="text-micro text-muted-foreground">
                    {[
                      product.listPrice != null
                        ? t("agentPortal.orderForm.fields.listPrice", {
                            amount: ltrIsolate(formatMoney(product.listPrice, currencyCode)),
                          })
                        : null,
                      productAvailable != null
                        ? t("orderEntry.availability.available", { count: productAvailable })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
              <Input
                aria-label={t("agentPortal.orderForm.fields.quantity")}
                dir="ltr"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                className="text-end tabular-nums"
                value={line.quantity}
                aria-invalid={(has("lines") && !(Number(line.quantity) > 0)) || undefined}
                onChange={(event) => setLine(line.key, { quantity: event.target.value })}
              />
              {showAmount ? (
                <MoneyInput
                  aria-label={t("agentPortal.orderForm.fields.lineAmount")}
                  placeholder={t("agentPortal.orderForm.fields.lineAmount")}
                  value={line.lineAmount}
                  aria-invalid={amountMissing || undefined}
                  onChange={(event) => setLine(line.key, { lineAmount: event.target.value })}
                />
              ) : (
                <span className="text-end text-caption text-muted-foreground @md:pt-2">
                  {quotedAmount != null ? (
                    <MoneyValue value={quotedAmount} currency={currency} />
                  ) : (
                    "—"
                  )}
                </span>
              )}
              <IconActionButton
                label={t("agentPortal.orderForm.removeLine")}
                disabled={lines.length === 1}
                className="self-end @md:self-start"
                onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
              >
                <Trash2 />
              </IconActionButton>
              {issues.length > 0 ? (
                <p className="text-caption text-destructive @md:col-span-4">
                  {issues.map((issue) => quoteIssueText(issue, t, locale)).join(" ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...lines, newAgentLine()])}
      >
        <Plus />
        {t("agentPortal.orderForm.addLine")}
      </EnterpriseButton>
      {has("lines") ? (
        <FieldMessage announce={false}>{t("agentPortal.orderForm.errors.lines")}</FieldMessage>
      ) : null}
      {has("lineAmount") ? (
        <FieldMessage announce={false}>{t("agentPortal.orderForm.errors.lineAmount")}</FieldMessage>
      ) : null}
    </div>
  );
}
