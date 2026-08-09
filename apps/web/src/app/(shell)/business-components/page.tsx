"use client";

import { Archive, Copy, Globe, Printer, ShoppingBag, Truck, UserRound } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  EntityHeader,
  StatusBadge,
  MoneyBadge,
  CurrencyDisplay,
  CustomerCard,
  SupplierCard,
  Timeline,
  AddressCard,
  QuickStatsCard,
  InfoSection,
  SummaryCard,
  EntityTabs,
  QuickActions,
} from "@/components/business";
import { useLocale } from "@/providers/locale-provider";

export default function BusinessComponentsPage() {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-10 pb-16">
      <PageHeader
        title={t("businessComponents.title")}
        subtitle={t("businessComponents.subtitle")}
      />

      <Section title={t("businessComponents.entityHeader")}>
        <EntityHeader
          icon={UserRound}
          title="Sample Customer Ltd."
          subtitle={t("businessComponents.sampleEntitySubtitle")}
          status={<StatusBadge label="Active" tone="success" />}
          actions={
            <QuickActions
              actions={[
                { label: t("businessComponents.actionPrint"), icon: Printer },
                { label: t("businessComponents.actionDuplicate"), icon: Copy },
              ]}
            />
          }
        />
      </Section>

      <Section title={t("businessComponents.statusBadge")}>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label="Active" tone="success" />
          <StatusBadge label="Pending" tone="warning" />
          <StatusBadge label="Rejected" tone="destructive" />
          <StatusBadge label="Draft" tone="neutral" />
          <StatusBadge label="Info" tone="info" />
        </div>
      </Section>

      <Section title={t("businessComponents.moneyBadge")}>
        <div className="flex flex-wrap items-center gap-4">
          <MoneyBadge amount={12500.5} currency="USD" tone="positive" />
          <MoneyBadge amount={-340} currency="USD" tone="negative" />
          <MoneyBadge amount={0} currency="USD" tone="neutral" />
          <CurrencyDisplay amount={98765.4} currency="SAR" locale="en-US" />
        </div>
      </Section>

      <Section title={t("businessComponents.partyCards")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <CustomerCard
            name="Sample Customer Ltd."
            code="CUST-1042"
            contact="+966 5X XXX XXXX"
            status="Active"
            statusTone="success"
          />
          <SupplierCard
            name="Sample Supplier Co."
            code="SUP-0087"
            contact="ops@sample-supplier.example"
            status="On Hold"
            statusTone="warning"
          />
        </div>
      </Section>

      <Section title={t("businessComponents.timelines")}>
        <Timeline
          entries={[
            { id: "1", title: "Order created", timestamp: "2 days ago", actor: "Sara Al-Amin" },
            {
              id: "2",
              title: "Approved by manager",
              status: "done",
              timestamp: "1 day ago",
              actor: "Omar Nasser",
            },
            { id: "3", title: "Awaiting shipment", status: "pending", timestamp: "Just now" },
          ]}
        />
      </Section>

      <Section title={t("businessComponents.addressCard")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <AddressCard
            label="Head Office"
            lines={["123 Sample Street", "Riyadh, Saudi Arabia", "12345"]}
            isDefault
            defaultLabel={t("businessComponents.sampleAddressDefault")}
          />
          <AddressCard label="Warehouse" lines={["Industrial Zone 4", "Jeddah, Saudi Arabia"]} />
        </div>
      </Section>

      <Section title={t("businessComponents.quickStatsCard")}>
        <QuickStatsCard
          stats={[
            { label: "Orders", value: 128, icon: ShoppingBag },
            { label: "Shipments", value: 42, icon: Truck },
            { label: "Countries", value: 6, icon: Globe },
          ]}
        />
      </Section>

      <Section title={t("businessComponents.infoSection")}>
        <InfoSection
          items={[
            { label: "Tax Number", value: "310123456700003" },
            { label: "Payment Terms", value: "Net 30" },
            { label: "Account Manager", value: "Sara Al-Amin" },
            { label: "Since", value: "2024" },
          ]}
        />
      </Section>

      <Section title={t("businessComponents.summaryCard")}>
        <SummaryCard
          title="Order Summary"
          rows={[
            { label: "Subtotal", value: <CurrencyDisplay amount={4200} currency="USD" /> },
            { label: "Tax", value: <CurrencyDisplay amount={630} currency="USD" /> },
            {
              label: "Total",
              value: <CurrencyDisplay amount={4830} currency="USD" />,
              emphasis: true,
            },
          ]}
        />
      </Section>

      <Section title={t("businessComponents.entityTabs")}>
        <EntityTabs
          tabs={[
            {
              value: "overview",
              label: t("businessComponents.tabOverview"),
              content: (
                <p className="text-body text-muted-foreground">
                  {t("businessComponents.overviewSample")}
                </p>
              ),
            },
            {
              value: "activity",
              label: t("businessComponents.tabActivity"),
              content: (
                <Timeline
                  entries={[{ id: "1", title: "Sample activity entry", timestamp: "Today" }]}
                />
              ),
            },
            {
              value: "documents",
              label: t("businessComponents.tabDocuments"),
              content: (
                <p className="text-body text-muted-foreground">
                  {t("businessComponents.documentsSample")}
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Section title={t("businessComponents.quickActions")}>
        <QuickActions
          actions={[
            { label: t("businessComponents.actionPrint"), icon: Printer },
            { label: t("businessComponents.actionDuplicate"), icon: Copy },
            { label: t("businessComponents.actionArchive"), icon: Archive, variant: "destructive" },
          ]}
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-section-title">{title}</h2>
      {children}
    </section>
  );
}
