"use client";

import type { LucideIcon } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

/**
 * The one shell every "prepared, not yet implemented" page renders through
 * (Settings categories, Reports categories) — a real breadcrumb + header
 * plus the shared `EmptyState`, never a bespoke placeholder layout. Once a
 * category gets real functionality, its page.tsx stops rendering this and
 * renders its own content instead — this component only exists for pages
 * that are foundation-only by design.
 */
export function ComingSoonPage({
  titleKey,
  descriptionKey,
  icon: Icon,
}: {
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  breadcrumbKeys: MessageKey[];
  icon: LucideIcon;
}) {
  const { t } = useLocale();

  return (
    <PageWorkspace title={t(titleKey)} description={descriptionKey ? t(descriptionKey) : undefined}>
      <div className="rounded-xl border border-dashed border-border py-6">
        <EmptyState
          icon={Icon}
          title={t("common.comingSoon")}
          description={t("common.comingSoonDescription")}
        />
      </div>
    </PageWorkspace>
  );
}
