"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { OrderBreakdown } from "@/components/agent-portal/order-breakdown";
import { quoteIssueText, workedHint, type WorkedHintKind } from "@/config/orders/agent-order-entry";
import type { OrderQuote } from "@/services/agent-portal-service";
import type { MessageKey } from "@/i18n/translate";
import { ltrIsolate } from "@/lib/bidi";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";

const HINT_KEYS: Record<WorkedHintKind, MessageKey> = {
  included: "agentPortal.orderForm.breakdown.hintIncluded",
  includedService: "agentPortal.orderForm.breakdown.hintIncludedService",
  added: "agentPortal.orderForm.breakdown.hintAdded",
  addedService: "agentPortal.orderForm.breakdown.hintAddedService",
};

export type AgentQuoteState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; quote: OrderQuote }
  /** `message`: the server's reason, or null (a generic failure is shown). */
  | { status: "failed"; key: string; message: string | null };

/**
 * The live price check of an agent order (`/orders/quote`): the server's
 * breakdown (merchandise, shipping with its source, service charge, payable
 * total), the worked arithmetic in plain words and every issue the server
 * reports. Nothing is computed here — a stale or missing quote says so.
 */
export function AgentQuoteSummary({
  state,
  current,
  currency,
}: {
  state: AgentQuoteState;
  /** The quote answers the form as it is now (not an older request). */
  current: boolean;
  currency: { code: string } | null;
}) {
  const { t, locale } = useLocale();
  const quote = state.status === "ready" ? state.quote : null;
  const hint = current ? workedHint(quote) : null;
  const money = (value: number) => formatMoney(value, currency?.code ?? null);
  const issues = quote?.issues ?? [];
  return (
    <div className="flex flex-col gap-2" data-testid="agent-quote" data-field-name="quote">
      {state.status === "idle" ? (
        <p className="text-caption text-muted-foreground">
          {t("agentPortal.orderForm.breakdown.waiting")}
        </p>
      ) : null}
      {state.status === "loading" || (state.status !== "idle" && !current) ? (
        <p className="flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          {t("agentPortal.orderForm.breakdown.checking")}
        </p>
      ) : null}
      {state.status === "failed" ? (
        <p className="text-caption text-destructive" role="alert">
          {state.message ?? t("agentPortal.orderForm.breakdown.failed")}
        </p>
      ) : null}
      {quote?.breakdown ? (
        <OrderBreakdown
          figures={quote.breakdown}
          currency={currency}
          shippingSource={quote.shipping.source}
          shippingRate={quote.shipping.rate}
          rateScope={quote.shipping.rateScope}
          provisional={quote.shippingPricingStatus === "PENDING_METHOD"}
          mode={quote.breakdown.mode}
        />
      ) : null}
      {hint ? (
        // The sentence keeps the reading direction; every amount is an isolated
        // left-to-right run (a leading "450.00 EGP" would otherwise flip it).
        <p className="rounded-sm bg-muted/50 px-2 py-1.5 text-caption text-muted-foreground">
          {t(HINT_KEYS[hint.kind], {
            total: ltrIsolate(money(hint.total)),
            shipping: ltrIsolate(money(hint.shipping)),
            merchandise: ltrIsolate(money(hint.merchandise)),
            service: ltrIsolate(money(hint.service)),
          })}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div
          className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive-soft px-3 py-2"
          role="alert"
        >
          <p className="text-caption font-medium text-destructive-soft-foreground">
            {t("agentPortal.orderForm.breakdown.issues")}
          </p>
          <ul className="flex flex-col gap-0.5">
            {issues.map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className="flex items-start gap-1.5 text-caption text-destructive-soft-foreground"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{quoteIssueText(issue, t, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
