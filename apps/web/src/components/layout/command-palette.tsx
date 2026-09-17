"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EnterpriseButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { navigationConfig } from "@/navigation/navigation.config";
import {
  flattenNavigationTree,
  buildNavigationTree,
  filterNavigationByAuth,
} from "@/navigation/build-navigation-tree";
import { iconRegistry } from "@/navigation/icon-registry";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/**
 * Global Search + Command Palette, unified into one launcher (⌘K / Ctrl+K)
 * — the same pattern Linear/Vercel/Notion use, matching this project's
 * stated visual inspiration. Currently only navigates between existing
 * pages; a future phase can register real business actions here.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { t } = useLocale();
  const { permissions, isSuperAdmin, status } = useUserContext();

  // Same canonical authorization filter the sidebar uses (ADR-0022 Part 4)
  // — the palette must never offer a destination the user would then hit
  // Access Denied on. Previously built from the raw, unfiltered config.
  // `accessReady` only waits out the initial `loading` bootstrap window —
  // an `error` status (a flaky `/auth/me` call) must fail closed, not skip
  // filtering indefinitely. See app-sidebar.tsx for the matching fix.
  const navigableItems = useMemo(
    () =>
      flattenNavigationTree(
        buildNavigationTree(
          filterNavigationByAuth(navigationConfig, permissions, {
            isSuperAdmin,
            accessReady: status !== "loading",
          }),
        ),
      ).filter((item) => item.route),
    [permissions, isSuperAdmin, status],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const runNavigate = (route: string) => {
    setOpen(false);
    router.push(route);
  };

  return (
    <>
      <EnterpriseButton
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-11 w-full justify-start gap-2.5 rounded-lg px-4 font-normal text-muted-foreground"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-start">{t("topbar.searchPlaceholder")}</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </EnterpriseButton>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("topbar.commandPaletteTitle")}
        description={t("topbar.commandPaletteDescription")}
      >
        <Command>
          <CommandInput placeholder={t("topbar.commandPalettePlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("common.noResults")}</CommandEmpty>
            <CommandGroup heading={t("topbar.commandPaletteGroupNavigate")}>
              {navigableItems.map((item) => {
                const Icon = item.icon ? iconRegistry[item.icon] : Search;
                const title = t(item.titleKey);
                return (
                  <CommandItem
                    key={item.id}
                    value={title}
                    onSelect={() => runNavigate(item.route!)}
                  >
                    <Icon />
                    <span>{title}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
