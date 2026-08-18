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
 * Master Data Home — the landing page for the standalone Master Data module
 * (TASK-024 Part 3): one card per entity, each linking straight to that
 * entity's own Enterprise DataTable + Enterprise Modal page. The Sidebar
 * already lists all 14 as direct children of "Master Data" for one-click
 * access; this hub exists for the "Master Data" breadcrumb root and for
 * anyone landing here directly to see the whole reference-data surface at
 * a glance.
 */
const masterDataEntities: {
  key: string;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  icon: IconName;
  href: string;
}[] = [
  {
    key: "warehouses",
    titleKey: "masterData.warehouses.title",
    descriptionKey: "masterData.warehouses.description",
    icon: "warehouse",
    href: "/master-data/warehouses",
  },
  {
    key: "analytic-plans",
    titleKey: "masterData.analyticPlans.title",
    descriptionKey: "masterData.analyticPlans.description",
    icon: "folder-kanban",
    href: "/master-data/analytic-plans",
  },
  {
    key: "analytic-accounts",
    titleKey: "masterData.analyticAccounts.title",
    descriptionKey: "masterData.analyticAccounts.description",
    icon: "git-branch",
    href: "/master-data/analytic-accounts",
  },
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
    key: "currencies",
    titleKey: "masterData.currencies.title",
    descriptionKey: "masterData.currencies.description",
    icon: "coins",
    href: "/master-data/currencies",
  },
  {
    key: "languages",
    titleKey: "masterData.languages.title",
    descriptionKey: "masterData.languages.description",
    icon: "languages",
    href: "/master-data/languages",
  },
  {
    key: "taxes",
    titleKey: "masterData.taxes.title",
    descriptionKey: "masterData.taxes.description",
    icon: "percent",
    href: "/master-data/taxes",
  },
  {
    key: "units",
    titleKey: "masterData.units.title",
    descriptionKey: "masterData.units.description",
    icon: "ruler",
    href: "/master-data/units",
  },
  {
    key: "categories",
    titleKey: "masterData.categories.title",
    descriptionKey: "masterData.categories.description",
    icon: "tags",
    href: "/master-data/categories",
  },
  {
    key: "brands",
    titleKey: "masterData.brands.title",
    descriptionKey: "masterData.brands.description",
    icon: "award",
    href: "/master-data/brands",
  },
  {
    key: "payment-methods",
    titleKey: "masterData.paymentMethods.title",
    descriptionKey: "masterData.paymentMethods.description",
    icon: "banknote",
    href: "/master-data/payment-methods",
  },
  {
    key: "shipping-methods",
    titleKey: "masterData.shippingMethods.title",
    descriptionKey: "masterData.shippingMethods.description",
    icon: "ship",
    href: "/master-data/shipping-methods",
  },
  {
    key: "customer-groups",
    titleKey: "masterData.customerGroups.title",
    descriptionKey: "masterData.customerGroups.description",
    icon: "users-round",
    href: "/master-data/customer-groups",
  },
  {
    key: "supplier-groups",
    titleKey: "masterData.supplierGroups.title",
    descriptionKey: "masterData.supplierGroups.description",
    icon: "users-round",
    href: "/master-data/supplier-groups",
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
