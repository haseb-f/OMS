"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ModalFieldFullWidth } from "@/components/shared/modal-section";
import { DetailField, DetailFieldGrid } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyValue } from "@/components/shared/money-value";
import { formatNumber } from "@/lib/format-number";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  productsService,
  type EffectiveAccountKind,
  type ProductEffectiveDefaults,
  type ProductInvestmentLinks,
} from "@/services/products-service";
import { INVESTMENT_REASON_KEYS } from "@/config/products/product-errors";

const ACCOUNT_KINDS: readonly EffectiveAccountKind[] = ["inventory", "cogs", "revenue", "purchase"];

/** Where an inherited value comes from, in words. */
function SourceTag({ source }: { source: string }) {
  const { t } = useLocale();
  return (
    <span className="ms-1 text-caption font-normal text-muted-foreground">
      ({t(`products.accounting.source.${source}` as MessageKey)})
    </span>
  );
}

/**
 * Read-only inheritance of a saved product (`effective-defaults`): the unit and
 * tax, the four accounts the Posting Engine resolves (shown only when the API
 * returns them) and — for an agent-owned product — the commission rate that
 * applies today and where it comes from. Nothing is entered here: accounts are
 * set once on the category / Posting Settings, never per product.
 */
export function ProductEffectiveDefaults({ productId }: { productId: string }) {
  const { t } = useLocale();
  const [defaults, setDefaults] = useState<ProductEffectiveDefaults | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    productsService
      .effectiveDefaults(productId)
      .then((result) => {
        if (cancelled) return;
        setDefaults(result);
        setState("ready");
      })
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (state === "loading") {
    return (
      <ModalFieldFullWidth>
        <Skeleton className="h-16 w-full" />
      </ModalFieldFullWidth>
    );
  }
  if (state === "failed" || !defaults) {
    return (
      <ModalFieldFullWidth>
        <p className="text-caption text-muted-foreground">{t("products.accounting.unavailable")}</p>
      </ModalFieldFullWidth>
    );
  }

  const { accounts, commission } = defaults;
  return (
    <ModalFieldFullWidth>
      <DetailFieldGrid columns={3}>
        <DetailField
          label={t("products.fields.unit")}
          value={
            <>
              {defaults.unit.name}
              <SourceTag source={defaults.unit.source} />
            </>
          }
        />
        <DetailField
          label={t("products.fields.taxGroup")}
          value={
            defaults.tax ? (
              <>
                {defaults.tax.name}
                <SourceTag source={defaults.tax.source} />
              </>
            ) : (
              t("products.accounting.noTax")
            )
          }
        />
        {accounts &&
          ACCOUNT_KINDS.map((kind) => {
            const account = accounts[kind];
            return (
              <DetailField
                key={kind}
                label={t(`products.accounting.accounts.${kind}` as MessageKey)}
                value={
                  account ? (
                    <>
                      <span dir="ltr">{account.code}</span> · {account.name}
                      <SourceTag source={account.source} />
                    </>
                  ) : (
                    t("products.accounting.notConfigured")
                  )
                }
              />
            );
          })}
        {commission && (
          <DetailField
            label={t("products.accounting.commission.label")}
            value={
              commission.source && commission.rate != null ? (
                <>
                  <span dir="ltr" className="num">
                    {formatNumber(commission.rate, { maxDecimals: 4 })}%
                  </span>
                  <span className="ms-1 text-caption font-normal text-muted-foreground">
                    ({t(`products.accounting.commission.source.${commission.source}` as MessageKey)}
                    )
                  </span>
                </>
              ) : (
                t("products.accounting.commission.none")
              )
            }
          />
        )}
      </DetailFieldGrid>
      <p className="mt-1 text-caption text-muted-foreground">
        {t("products.accounting.hint")}{" "}
        <Link
          href="/master-data/categories"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          {t("products.accounting.openCategories")}
          <ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden />
        </Link>
      </p>
    </ModalFieldFullWidth>
  );
}

/**
 * Investor eligibility (`investment-links`) and the active opportunities that
 * already carry this product. The opportunity list exists only for holders of
 * `investment-opportunities.view` (the API sends `null` otherwise); nothing
 * here creates funding, allocation or profit.
 */
export function ProductInvestmentLinksPanel({ productId }: { productId: string }) {
  const { t, locale } = useLocale();
  const [links, setLinks] = useState<ProductInvestmentLinks | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    productsService
      .investmentLinks(productId)
      .then((result) => {
        if (cancelled) return;
        setLinks(result);
        setState("ready");
      })
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (state === "loading") {
    return (
      <ModalFieldFullWidth>
        <Skeleton className="h-12 w-full" />
      </ModalFieldFullWidth>
    );
  }
  if (state === "failed" || !links) {
    return (
      <ModalFieldFullWidth>
        <p className="text-caption text-muted-foreground">{t("products.investment.unavailable")}</p>
      </ModalFieldFullWidth>
    );
  }

  return (
    <ModalFieldFullWidth className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={links.eligible ? "success" : "neutral"}
          label={t(
            links.eligible ? "products.investment.eligible" : "products.investment.notEligible",
          )}
        />
        {links.blockedReason && (
          <span className="text-caption text-muted-foreground">
            {t(INVESTMENT_REASON_KEYS[links.blockedReason])}
          </span>
        )}
      </div>
      {links.opportunities === null ? (
        <p className="text-caption text-muted-foreground">
          {t("products.investment.opportunitiesHidden")}
        </p>
      ) : links.opportunities.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("products.investment.noneLinked")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.opportunities.map((opportunity) => (
            <li
              key={opportunity.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border px-2 py-1.5"
            >
              <Link
                href={`/investors/opportunities/${opportunity.id}`}
                target="_blank"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                <span dir="ltr">{opportunity.code}</span> ·{" "}
                {locale === "ar" ? opportunity.nameAr : (opportunity.nameEn ?? opportunity.nameAr)}
              </Link>
              <StatusBadge
                tone="info"
                label={t(`investors.opportunities.status.${opportunity.status}` as MessageKey)}
              />
              <span className="ms-auto text-caption text-muted-foreground">
                <span dir="ltr" className="num">
                  {formatNumber(opportunity.fundedUnits)}
                </span>{" "}
                {t("products.investment.units")} × <MoneyValue value={opportunity.fundedUnitCost} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">{t("products.investment.rule")}</p>
    </ModalFieldFullWidth>
  );
}
