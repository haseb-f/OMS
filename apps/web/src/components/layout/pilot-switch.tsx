"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { useUiPilot } from "@/providers/ui-pilot-provider";
import { useLocale } from "@/providers/locale-provider";

/**
 * Round 3 reviewer switch (spec "Round 3"): compares the pilot design with
 * the current one on the same page. Rendered only on pilot routes of a build
 * with the pilot enabled; removed at rollout.
 */
export function PilotSwitch() {
  const { t } = useLocale();
  const { available, active, setEnabled } = useUiPilot();
  const id = useId();
  if (!available) return null;
  return (
    <div className="hidden items-center gap-2 md:flex">
      <label htmlFor={id} className="cursor-pointer text-caption text-muted-foreground">
        {t("topbar.pilotDesign")}
      </label>
      <Switch id={id} checked={active} onCheckedChange={setEnabled} />
    </div>
  );
}
