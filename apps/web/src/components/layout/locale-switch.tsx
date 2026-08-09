"use client";

import { Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { locales, localeLabel } from "@/i18n/locales";

/** Switching locale switches both the rendered text and the layout direction together — RTL is derived from locale, never toggled on its own. */
export function LocaleSwitch() {
  const { locale, setLocale, t } = useLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <EnterpriseButton variant="ghost" size="icon-sm" aria-label={t("topbar.changeLanguage")}>
          <Languages />
        </EnterpriseButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((option) => (
          <DropdownMenuItem key={option} onClick={() => setLocale(option)}>
            <span className="flex-1">{localeLabel[option]}</span>
            {locale === option && <span className="text-xs text-muted-foreground">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
