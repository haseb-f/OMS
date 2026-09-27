"use client";

import { Construction, type LucideIcon } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * Placeholder panel for a feature that is planned but not built — a dashed
 * frame + "Coming soon" so it can never be mistaken for an empty data state.
 * Use inside tabs/sections; full routes use `ComingSoonPage`.
 */
export function ComingSoonPanel({
  icon = Construction,
  className,
}: {
  icon?: LucideIcon;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      data-placeholder="coming-soon"
      className={cn(
        "flex flex-1 items-center justify-center rounded-md border border-dashed border-border-strong",
        className,
      )}
    >
      <EmptyState
        icon={icon}
        title={t("common.comingSoon")}
        description={t("common.comingSoonDescription")}
      />
    </div>
  );
}

/**
 * The one shell every "prepared, not yet implemented" page renders through
 * (Settings categories, Reports categories) — a real breadcrumb + header
 * plus the shared placeholder panel, never a bespoke placeholder layout.
 * Once a category gets real functionality, its page.tsx stops rendering this.
 */
export function ComingSoonPage({
  titleKey,
  descriptionKey,
  icon: Icon,
}: {
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  icon: LucideIcon;
}) {
  const { t } = useLocale();

  return (
    <PageWorkspace title={t(titleKey)} description={descriptionKey ? t(descriptionKey) : undefined}>
      <ComingSoonPanel icon={Icon} />
    </PageWorkspace>
  );
}
