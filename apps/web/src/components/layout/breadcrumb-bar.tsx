"use client";

import Link from "next/link";
import { Fragment } from "react";
import { Home } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useCurrentNavigation } from "@/hooks/use-current-navigation";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbValue } from "@/providers/breadcrumb-provider";

/**
 * A dedicated Breadcrumb layer between the TopBar and each page's own
 * header. The root crumb is a Home icon, not the "OMS" wordmark — the logo
 * belongs only to the Sidebar, never repeated inside pages (ADR-0019). The
 * ONE place breadcrumb navigation is rendered — no page builds its own;
 * a dynamic detail page (a Lead, a Customer, ...) only ever supplies the
 * trailing crumb's text via `useBreadcrumbLabel`, never the whole trail.
 */
export function BreadcrumbBar() {
  const { breadcrumb, isExactMatch } = useCurrentNavigation();
  const { t } = useLocale();
  const dynamicLabel = useBreadcrumbValue();

  if (breadcrumb.length === 0) return null;
  // On a dynamic sub-page (isExactMatch === false) the resolved trail ends
  // at its list-page ANCESTOR, which must stay clickable — the page's own
  // label (once loaded) becomes the actual final, non-clickable crumb.
  const showDynamicCrumb = !isExactMatch && dynamicLabel;

  return (
    <div className="px-6 py-2 text-caption">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/" aria-label={t("nav.dashboard")}>
                <Home className="size-3.5" />
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {breadcrumb.map((item, index) => {
            // The resolved trail's own last item is only the actual
            // current page when the route matched exactly — otherwise a
            // dynamic sub-page crumb follows it below, so this one must
            // stay clickable like any other ancestor.
            const isFinalCrumb = index === breadcrumb.length - 1 && !showDynamicCrumb;
            const title = t(item.titleKey);
            return (
              <Fragment key={item.id}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {isFinalCrumb || !item.route ? (
                    <BreadcrumbPage>{title}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={item.route}>{title}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
          {showDynamicCrumb && (
            <Fragment>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{dynamicLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </Fragment>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
