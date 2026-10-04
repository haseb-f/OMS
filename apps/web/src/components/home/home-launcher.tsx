"use client";

import { useMemo } from "react";
import { Inbox } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { LauncherTile } from "@/components/shared/launcher-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { iconRegistry } from "@/navigation/icon-registry";
import { buildHomeActions, buildHomeTiles } from "@/navigation/home-tiles";
import { navigationConfig } from "@/navigation/navigation.config";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/**
 * The Home screen (design-system §12.17): a permission-aware launcher that is
 * the landing page of every login (`/` for company users, `/agent` for agent
 * users) — not a dashboard. Tiles come from `buildHomeTiles` /
 * `buildHomeActions`, which reuse the sidebar's own filter and the route
 * guard's own access rule, so only destinations the user may open appear. The
 * Dashboard is one of those destinations and stays a separate page. Until the
 * session's permissions are known the page shows skeletons — an unknown
 * permission set is never read as "nothing to open".
 */
export function HomeLauncher() {
  const { t } = useLocale();
  const { status, permissions, isSuperAdmin, user } = useUserContext();
  const userType = user?.userType;

  const { tiles, actions } = useMemo(() => {
    if (status !== "authenticated") return { tiles: [], actions: [] };
    const access = { permissions, isSuperAdmin, userType };
    return {
      tiles: buildHomeTiles(navigationConfig, access),
      actions: buildHomeActions(navigationConfig, access),
    };
  }, [status, permissions, isSuperAdmin, userType]);

  const loading = status === "loading";

  return (
    <PageWorkspace title={t("home.title")} description={t("home.subtitle")}>
      <div data-slot="home-surface" className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-2">
        {loading ? (
          <div aria-busy="true" className="flex flex-wrap justify-center gap-3">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton
                key={index}
                className="h-24 w-full basis-full sm:basis-52 sm:max-w-72 sm:grow"
              />
            ))}
          </div>
        ) : tiles.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t("home.emptyTitle")}
            description={t("home.emptyDescription")}
          />
        ) : (
          <>
            <section aria-labelledby="home-modules" className="flex flex-col gap-3">
              <h2
                id="home-modules"
                className="text-center text-caption font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t("home.modulesTitle")}
              </h2>
              <ul className="flex flex-wrap justify-center gap-3">
                {tiles.map((tile) => (
                  <li
                    key={tile.id}
                    className="flex w-full basis-full sm:basis-56 sm:max-w-72 sm:grow"
                  >
                    <LauncherTile
                      href={tile.href}
                      title={t(tile.titleKey)}
                      tone={tile.tone}
                      icon={tile.icon ? iconRegistry[tile.icon] : undefined}
                      caption={tile.previewKeys.map((key) => t(key)).join(" · ")}
                      ariaLabel={t("home.open", { name: t(tile.titleKey) })}
                      className="w-full"
                    />
                  </li>
                ))}
              </ul>
            </section>
            {actions.length > 0 ? (
              <section aria-labelledby="home-actions" className="flex flex-col gap-3">
                <h2
                  id="home-actions"
                  className="text-center text-caption font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  {t("home.actionsTitle")}
                </h2>
                <ul className="flex flex-wrap justify-center gap-2.5">
                  {actions.map((action) => (
                    <li
                      key={action.id}
                      className="flex w-full basis-full sm:basis-52 sm:max-w-64 sm:grow"
                    >
                      <LauncherTile
                        href={action.href}
                        title={t(action.titleKey)}
                        tone={action.tone}
                        icon={iconRegistry[action.icon]}
                        size="action"
                        className="w-full"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </PageWorkspace>
  );
}
