"use client";

import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { Building2 } from "lucide-react";
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
import { EnterpriseButton } from "@/components/ui/button";

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
        <EnterpriseButton
          type="button"
          variant="menu"
          aria-label={t("company.switcherLabel")}
          className="h-10 w-full justify-start gap-2 px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-xs bg-(--selector-chip)">
            <Building2 className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col items-start justify-center text-start leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-caption font-semibold">{activeCompany.name}</span>
            <span className="truncate text-micro text-selector-muted">
              {activeBranch?.name ?? t("company.noBranch")}
            </span>
          </span>
          <TriggerChevron size="sm" className="group-data-[collapsible=icon]:hidden" />
        </EnterpriseButton>
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
