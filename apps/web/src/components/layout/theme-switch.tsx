"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();
  // Avoid a hydration mismatch: the resolved theme is only known client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const options = [
    { value: "light", label: t("topbar.themeLight"), icon: Sun },
    { value: "dark", label: t("topbar.themeDark"), icon: Moon },
    { value: "system", label: t("topbar.themeSystem"), icon: SunMoon },
  ] as const;

  const ActiveIcon = options.find((option) => option.value === theme)?.icon ?? SunMoon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <EnterpriseButton variant="ghost" size="icon-sm" aria-label={t("topbar.changeTheme")}>
          {mounted ? <ActiveIcon /> : <SunMoon />}
        </EnterpriseButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)}>
            <option.icon />
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
