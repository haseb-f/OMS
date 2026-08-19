"use client";

import Link from "next/link";
import {
  EnterpriseCard,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
  EnterpriseCardDescription,
} from "@/components/ui/card";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { useLocale } from "@/providers/locale-provider";
import { iconRegistry, type IconName } from "@/navigation/icon-registry";
import type { MessageKey } from "@/i18n/translate";

/**
 * Master Data Home — leftover geographic/language reference data. Domain
 * master data (warehouses, payment methods, groups) is listed under its
 * owning sidebar section. Shipping statuses, methods, and companies live
 * under Shipping, not here.
 */
const masterDataEntities: {
  key: string;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  icon: IconName;
  href: string;
}[] = [
  {
    key: "countries",
    titleKey: "masterData.countries.title",
    descriptionKey: "masterData.countries.description",
    icon: "globe",
    href: "/master-data/countries",
  },
  {
    key: "cities",
    titleKey: "masterData.cities.title",
    descriptionKey: "masterData.cities.description",
    icon: "map-pin",
    href: "/master-data/cities",
  },
  {
    key: "languages",
    titleKey: "masterData.languages.title",
    descriptionKey: "masterData.languages.description",
    icon: "languages",
    href: "/master-data/languages",
  },
];

export default function MasterDataHomePage() {
  const { t } = useLocale();

  return (
    <PageWorkspace title={t("masterData.hub.title")} description={t("masterData.hub.description")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {masterDataEntities.map((entity) => {
          const Icon = iconRegistry[entity.icon];
          return (
            <Link key={entity.key} href={entity.href}>
              <EnterpriseCard size="sm" clickable className="h-full">
                <EnterpriseCardHeader>
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <EnterpriseCardTitle>{t(entity.titleKey)}</EnterpriseCardTitle>
                  </div>
                  <EnterpriseCardDescription>{t(entity.descriptionKey)}</EnterpriseCardDescription>
                </EnterpriseCardHeader>
              </EnterpriseCard>
            </Link>
          );
        })}
      </div>
    </PageWorkspace>
  );
}
