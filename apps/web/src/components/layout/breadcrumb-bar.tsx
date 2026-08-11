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

/**
 * A dedicated Breadcrumb layer between the TopBar and each page's own
 * header. The root crumb is a Home icon, not the "OMS" wordmark — the logo
 * belongs only to the Sidebar, never repeated inside pages (ADR-0019).
 */
export function BreadcrumbBar() {
  const { breadcrumb } = useCurrentNavigation();
  const { t } = useLocale();

  if (breadcrumb.length === 0) return null;

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
            const isLast = index === breadcrumb.length - 1;
            const title = t(item.titleKey);
            return (
              <Fragment key={item.id}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {isLast || !item.route ? (
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
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
