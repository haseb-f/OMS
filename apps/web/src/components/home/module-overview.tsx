"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft, Inbox } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { LauncherTile } from "@/components/shared/launcher-tile";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDestinationCounts } from "@/components/home/module-overview-counts";
import { formatNumber } from "@/lib/format-number";
import { iconRegistry } from "@/navigation/icon-registry";
import { buildHomeTiles } from "@/navigation/home-tiles";
import { buildModuleOverview } from "@/navigation/module-overview";
import { NAVIGATION_GROUPS, navigationConfig } from "@/navigation/navigation.config";
import { homePathFor } from "@/navigation/post-login";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/**
 * A module's overview (design-system §12.17): what Home → module opens. It lists
 * the module's authorized destinations as compact tiles, each with one line on
 * what the page is for and — where the destination's own list reports one — its
 * record count. Built from the same navigation entries and access filter as the
 * sidebar (`buildModuleOverview`); a module with nothing authorized (or an unknown
 * id) shows the no-access state, never a partial or fabricated page.
 */
export function ModuleOverviewPage({ moduleId }: { moduleId: string }) {
  const { t } = useLocale();
  const { status, permissions, isSuperAdmin, user } = useUserContext();
  const userType = user?.userType;

  const { overview, tone } = useMemo(() => {
    if (status !== "authenticated") return { overview: null, tone: undefined };
    const access = { permissions, isSuperAdmin, userType };
    return {
      overview: buildModuleOverview(navigationConfig, access, moduleId, NAVIGATION_GROUPS),
      tone: buildHomeTiles(navigationConfig, access).find((tile) => tile.id === moduleId)?.tone,
    };
  }, [status, permissions, isSuperAdmin, userType, moduleId]);

  const destinationIds = useMemo(
    () => overview?.sections.flatMap((section) => section.destinations.map((d) => d.id)) ?? [],
    [overview],
  );
  const counts = useDestinationCounts(destinationIds);

  if (status === "loading") {
    return (
      <PageWorkspace title={t("home.title")}>
        <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      </PageWorkspace>
    );
  }

  if (!overview) {
    return (
      <PageWorkspace title={t("home.title")}>
        <EmptyState
          icon={Inbox}
          title={t("home.module.noAccessTitle")}
          description={t("home.module.noAccessDescription")}
          action={
            <EnterpriseButton asChild variant="outline">
              <Link href={homePathFor(userType)}>
                <ArrowLeft className="rtl:rotate-180" />
                {t("home.module.backToHome")}
              </Link>
            </EnterpriseButton>
          }
        />
      </PageWorkspace>
    );
  }

  const moduleName = t(overview.titleKey);
  const multiSection = overview.sections.length > 1;
  const sectionTitle = (groupId: (typeof overview.sections)[number]["groupId"]) =>
    groupId ? t(NAVIGATION_GROUPS[groupId].titleKey) : t("home.module.pagesTitle");

  return (
    <PageWorkspace title={moduleName} description={t("home.module.subtitle", { name: moduleName })}>
      <div data-slot="module-overview" className="flex w-full max-w-6xl flex-col gap-5 py-2">
        {overview.sections.map((section) => (
          <section
            key={section.groupId ?? "pages"}
            aria-label={sectionTitle(section.groupId)}
            className="flex flex-col gap-2.5"
          >
            {multiSection ? (
              <h2 className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
                {sectionTitle(section.groupId)}
              </h2>
            ) : null}
            <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {section.destinations.map((destination) => {
                const count = counts[destination.id];
                return (
                  <li key={destination.id} className="flex">
                    <LauncherTile
                      href={destination.route}
                      title={t(destination.titleKey)}
                      caption={t(destination.descriptionKey)}
                      tone={tone ?? "blue"}
                      icon={destination.icon ? iconRegistry[destination.icon] : undefined}
                      meta={
                        count === undefined ? undefined : (
                          <span title={t("home.module.records", { count })}>
                            {formatNumber(count)}
                          </span>
                        )
                      }
                      className="w-full"
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </PageWorkspace>
  );
}
