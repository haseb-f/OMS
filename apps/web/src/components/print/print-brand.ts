"use client";

import { useCompany } from "@/providers/company-provider";
import type { DocumentBranding } from "@/types/document-engine";
import type { PrintCompanyInfo } from "@/types/print-engine";

/**
 * Builders used to hard-code a green brand color; treat that legacy value as
 * "no brand color" so the active company's color (or the primary token) wins.
 */
const LEGACY_BUILDER_COLOR = "#0f8a5f";

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
 * Resolves the company block + accent color for a print sheet: the payload's
 * own values first, then the active company (name, logo, brand color from
 * the existing company context), then the primary design token.
 */
export function usePrintIdentity(
  company: PrintCompanyInfo,
  accentColor?: string | null,
): { company: PrintCompanyInfo; accentColor: string } {
  const { activeCompany } = useCompany();
  const explicit =
    accentColor && accentColor.toLowerCase() !== LEGACY_BUILDER_COLOR ? accentColor : null;
  return {
    company: {
      ...company,
      name: company.name || activeCompany?.name || "",
      logoUrl: company.logoUrl ?? activeCompany?.logoUrl ?? null,
    },
    accentColor: explicit ?? activeCompany?.primaryColor ?? "var(--primary)",
  };
}
