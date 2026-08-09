"use client";

import { Building2, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";

/**
 * Every future API request must know its Company (and Branch) context
 * (ADR-0022) — this is the one place a user changes that context. Hidden
 * entirely when the user has no company membership yet.
 */
export function CompanySwitcher() {
  const { t } = useLocale();
  const { companies, activeCompany, activeBranchId, setActiveCompanyId, setActiveBranchId } =
    useCompany();

  if (!activeCompany) return null;

  const activeBranch = activeCompany.branches.find((branch) => branch.id === activeBranchId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("company.switcherLabel")}
          className="flex h-16 w-full shrink-0 items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 text-start text-sidebar-foreground outline-none transition-colors duration-(--duration-base) ease-(--ease-standard) hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Building2 className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-caption font-semibold">{activeCompany.name}</span>
            <span className="truncate text-[11px] leading-tight text-sidebar-foreground/60">
              {activeBranch?.name ?? t("company.noBranch")}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("company.companies")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeCompany.id} onValueChange={setActiveCompanyId}>
          {companies.map((company) => (
            <DropdownMenuRadioItem key={company.id} value={company.id}>
              {company.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {activeCompany.branches.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("company.branches")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={activeBranchId ?? ""} onValueChange={setActiveBranchId}>
              {activeCompany.branches.map((branch) => (
                <DropdownMenuRadioItem key={branch.id} value={branch.id}>
                  {branch.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
