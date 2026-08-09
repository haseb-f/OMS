"use client";

import { useEffect, useState } from "react";
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
import { navigationConfig } from "@/navigation/navigation.config";
import { flattenNavigationTree, buildNavigationTree } from "@/navigation/build-navigation-tree";
import { iconRegistry } from "@/navigation/icon-registry";
import { useLocale } from "@/providers/locale-provider";

const navigableItems = flattenNavigationTree(buildNavigationTree(navigationConfig)).filter(
  (item) => item.route,
);

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-4 text-body text-muted-foreground shadow-xs transition-all duration-(--duration-base) ease-(--ease-standard) hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-start">{t("topbar.searchPlaceholder")}</span>
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded border bg-card px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
          <span>⌘</span>K
        </kbd>
      </button>

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
