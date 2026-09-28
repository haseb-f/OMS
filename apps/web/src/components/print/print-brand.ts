"use client";

import { useMemo } from "react";
import { siteConfig } from "@/config/site";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import type { CompanyContext } from "@/services/auth-service";
import type { DocumentBranding } from "@/types/document-engine";
import type { PrintCompanyInfo } from "@/types/print-engine";

/**
 * Builders used to hard-code a green brand color; treat that legacy value as
 * "no brand color" so the active company's color (or the primary token) wins.
 */
const LEGACY_BUILDER_COLOR = "#0f8a5f";

/**
 * Deployment-level company profile for printouts, used only when the user has
 * no company of their own (no CompanyMembership). Set on the web project,
 * e.g. `NEXT_PUBLIC_PRINT_COMPANY_NAME`; never the product name.
 */
const CONFIGURED_PRINT_COMPANY = {
  name: process.env.NEXT_PUBLIC_PRINT_COMPANY_NAME?.trim() || "",
  logoUrl: process.env.NEXT_PUBLIC_PRINT_COMPANY_LOGO_URL?.trim() || null,
};

/**
 * The one rule for the company printed on every sheet (header, logo):
 *
 * 1. the active company (the user's selected CompanyMembership);
 * 2. else the user's first company;
 * 3. else the deployment's configured print company profile;
 * 4. else a neutral placeholder that says the profile is not set
 *    (`placeholder: true` — no initials badge, never a fabricated company and
 *    never the product name "OMS").
 *
 * No API exposes a company profile to a user without a membership, so step 3
 * is the only non-membership source.
 */
export function resolvePrintCompany(input: {
  activeCompany: Pick<CompanyContext, "name" | "logoUrl"> | null | undefined;
  companies?: Pick<CompanyContext, "name" | "logoUrl">[];
  configured?: { name: string; logoUrl: string | null };
  placeholderName: string;
}): PrintCompanyInfo {
  const membership = input.activeCompany?.name
    ? input.activeCompany
    : input.companies?.find((c) => c.name);
  if (membership?.name) return { name: membership.name, logoUrl: membership.logoUrl ?? null };
  const configured = input.configured ?? CONFIGURED_PRINT_COMPANY;
  if (configured.name) return { name: configured.name, logoUrl: configured.logoUrl };
  return { name: input.placeholderName, logoUrl: null, placeholder: true };
}

/** The resolved print company for the current user — every print entry point uses this. */
export function usePrintCompany(): PrintCompanyInfo {
  const { activeCompany, companies } = useCompany();
  const { t } = useLocale();
  const placeholderName = t("printDocument.companyNotSet");
  return useMemo(
    () => resolvePrintCompany({ activeCompany, companies, placeholderName }),
    [activeCompany, companies, placeholderName],
  );
}

/**
 * Branding every document print builder passes — logo only. Brand color and
 * direction are resolved at render time from the active company and UI
 * language (never hard-coded per builder); paper size stays portrait because
 * statements are forced landscape by the template.
 */
export function documentPrintBranding(logoUrl: string | null): DocumentBranding {
  return {
    logoUrl,
    primaryColor: "",
    secondaryColor: "",
    paperSize: "a4-portrait",
    language: "rtl",
  };
}

/**
 * Resolves the company block + accent color on a print sheet: the payload's
 * own company first (resolved by `usePrintCompany` at the entry point); an
 * empty or legacy product-name payload is re-resolved here with the same
 * rule, so a sheet never shows a blank header or "OMS" as the company.
 */
export function usePrintIdentity(
  company: PrintCompanyInfo,
  accentColor?: string | null,
): { company: PrintCompanyInfo; accentColor: string } {
  const { activeCompany } = useCompany();
  const fallback = usePrintCompany();
  const explicit =
    accentColor && accentColor.toLowerCase() !== LEGACY_BUILDER_COLOR ? accentColor : null;
  const hasOwnName = !!company.name && !isProductName(company.name);
  return {
    company: hasOwnName
      ? { ...company, logoUrl: company.logoUrl ?? fallback.logoUrl ?? null }
      : { ...company, ...fallback },
    accentColor: explicit ?? activeCompany?.primaryColor ?? "var(--primary)",
  };
}

/** Older list/report payloads used the product name as the company — never print it as one. */
function isProductName(name: string): boolean {
  return name === siteConfig.fullName || name === siteConfig.name;
}
