"use client";

import Link from "next/link";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BackButton } from "@/components/shared/back-button";
import { useCurrentNavigation } from "@/hooks/use-current-navigation";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbValue } from "@/providers/breadcrumb-provider";
import { cn } from "@/lib/utils";

/**
 * The ONE place breadcrumb + Back navigation is rendered. Pages never build
 * their own trail; a dynamic detail page only supplies the trailing crumb
 * via `useBreadcrumbLabel`. Back prefers in-app history so list state
 * survives, and falls back to the closest registered parent list.
 */
export function BreadcrumbBar() {
  const { breadcrumb, parentRoute, isExactMatch } = useCurrentNavigation();
  const { t } = useLocale();
  const dynamicLabel = useBreadcrumbValue();

  const showDynamicCrumb = !isExactMatch;
  const crumbs = breadcrumb.filter((item, index) => {
    if (item.route === "/") return false;
    const next = breadcrumb[index + 1];
    return !next || t(item.titleKey) !== t(next.titleKey);
  });
  const totalAfterHome = crumbs.length + (showDynamicCrumb ? 1 : 0);
  const collapseMobile = totalAfterHome > 2;

  if (totalAfterHome === 0 && !parentRoute) {
    return (
      <div className="flex min-w-0 items-center px-6 py-1.5">
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem>
              <BreadcrumbPage>{t("common.home")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden px-6 py-1.5">
      {parentRoute ? <BackButton href={parentRoute} /> : null}
      <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
        <BreadcrumbList className="flex-nowrap overflow-hidden">
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink asChild>
              <Link href="/">{t("common.home")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {collapseMobile ? (
            <>
              <BreadcrumbSeparator className="md:hidden" />
              <BreadcrumbItem className="md:hidden">
                <BreadcrumbEllipsis />
              </BreadcrumbItem>
            </>
          ) : null}
          {crumbs.map((item, index) => {
            const isFinalCrumb = index === crumbs.length - 1 && !showDynamicCrumb;
            const hideOnMobile = collapseMobile && (showDynamicCrumb || index < crumbs.length - 1);
            const title = t(item.titleKey);
            return (
              <Fragment key={item.id}>
                <BreadcrumbSeparator className={hideOnMobile ? "max-md:hidden" : undefined} />
                <BreadcrumbItem className={cn("min-w-0", hideOnMobile && "max-md:hidden")}>
                  {isFinalCrumb || !item.route ? (
                    <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={item.route} className="truncate">
                        {title}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
          {showDynamicCrumb ? (
            <Fragment>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate" dir="ltr">
                  {dynamicLabel ?? "\u00a0"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </Fragment>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
