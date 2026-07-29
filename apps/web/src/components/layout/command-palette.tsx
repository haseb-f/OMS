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
        className="flex h-8 w-full max-w-64 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-start">Search…</span>
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
          <span>⌘</span>K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command Palette"
        description="Search modules and pages"
      >
        <Command>
          <CommandInput placeholder="Search modules and pages…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Navigate">
              {navigableItems.map((item) => {
                const Icon = item.icon ? iconRegistry[item.icon] : Search;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.title}
                    onSelect={() => runNavigate(item.route!)}
                  >
                    <Icon />
                    <span>{item.title}</span>
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
