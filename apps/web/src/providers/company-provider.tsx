"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { setActiveCompanyContext } from "@/services/api-client";
import type { CompanyContext } from "@/services/auth-service";

interface CompanyContextValue {
  companies: CompanyContext[];
  activeCompany: CompanyContext | null;
  activeBranchId: string | null;
  setActiveCompanyId: (companyId: string) => void;
  setActiveBranchId: (branchId: string) => void;
}

const CompanyProviderContext = createContext<CompanyContextValue | null>(null);

/**
 * Every future API request must know which Company (and optionally Branch)
 * it's scoped to (ADR-0022). The active selection is persisted locally and
 * mirrored into the api-client so it rides along on every request header —
 * no business module has to remember to pass it explicitly.
 */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const companies = useMemo(() => user?.companies ?? [], [user]);

  const [activeCompanyId, setActiveCompanyId] = useLocalStorage<string | null>(
    STORAGE_KEYS.activeCompanyId,
    null,
  );
  const [activeBranchId, setActiveBranchId] = useLocalStorage<string | null>(
    STORAGE_KEYS.activeBranchId,
    null,
  );

  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ?? companies[0] ?? null;

  // Default to (or recover from an invalid) the first company/branch the user has access to.
  useEffect(() => {
    if (!activeCompany) return;
    if (activeCompany.id !== activeCompanyId) setActiveCompanyId(activeCompany.id);
    const branchStillValid = activeCompany.branches.some((branch) => branch.id === activeBranchId);
    if (!branchStillValid) {
      setActiveBranchId(activeCompany.defaultBranchId ?? activeCompany.branches[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id]);

  useEffect(() => {
    setActiveCompanyContext(activeCompany?.id ?? null, activeBranchId);
  }, [activeCompany?.id, activeBranchId]);

  return (
    <CompanyProviderContext.Provider
      value={{
        companies,
        activeCompany,
        activeBranchId,
        setActiveCompanyId,
        setActiveBranchId,
      }}
    >
      {children}
    </CompanyProviderContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyProviderContext);
  if (!context) throw new Error("useCompany must be used within a CompanyProvider");
  return context;
}
