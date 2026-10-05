"use client";

import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseBadge } from "@/components/ui/badge";
import { useLocale } from "@/providers/locale-provider";
import type { SimilarProductName } from "@/services/products-service";

/**
 * Non-blocking "a product with a similar name already exists" hint under the
 * name field. The links open the other product in a NEW tab so the form in
 * progress is never lost; saving is never prevented — creating anyway is the
 * implied choice.
 */
export function SimilarProductNames({ items }: { items: SimilarProductName[] }) {
  const { t } = useLocale();
  if (items.length === 0) return null;
  return (
    <Alert tone="warning" role="status" aria-live="polite">
      <TriangleAlert aria-hidden />
      <AlertDescription className="flex flex-col gap-1">
        <p className="font-medium">{t("products.similar.title")}</p>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <a
                href={`/products/${item.id}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline-offset-2 hover:underline"
              >
                <span dir="ltr">{item.sku}</span> · {item.displayName || item.name}
              </a>
              <EnterpriseBadge variant="outline">
                {t(`products.similar.match.${item.match}`)}
              </EnterpriseBadge>
              <span className="text-muted-foreground">{item.categoryName}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t("products.similar.hint")}</p>
      </AlertDescription>
    </Alert>
  );
}
