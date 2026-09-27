"use client";

import { Archive, Copy, Globe, Printer, ShoppingBag, Truck, UserRound } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  StatusBadge,
  CurrencyDisplay,
  CustomerCard,
  SupplierCard,
  Timeline,
  AddressCard,
  EntityTabs,
  QuickActions,
} from "@/components/business";
import {
  DetailField,
  DetailFieldGrid,
  RecordHighlightsHeader,
} from "@/components/shared/detail-workspace";
import { KpiCard } from "@/components/shared/kpi-card";
import { MoneyValue } from "@/components/shared/money-value";
import { DocumentTotalsBlock } from "@/components/documents/document-totals";
import { useLocale } from "@/providers/locale-provider";

export default function BusinessComponentsPage() {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-10 pb-16">
      <PageWorkspace
        title={t("businessComponents.title")}
        description={t("businessComponents.subtitle")}
      />

      <Section title={t("businessComponents.entityHeader")}>
        <RecordHighlightsHeader
          identity={
            <span className="inline-flex min-w-0 items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-ui-title font-semibold">Sample Customer Ltd.</span>
              <span className="text-caption text-muted-foreground">
                {t("businessComponents.sampleEntitySubtitle")}
              </span>
            </span>
          }
          status={<StatusBadge label="Active" tone="success" />}
          primaryActions={
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
          <MoneyValue value={12500.5} currency="USD" />
          <MoneyValue value={-340} currency="USD" />
          <MoneyValue value={0} currency="USD" />
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard size="compact" label="Orders" value={128} icon={ShoppingBag} />
          <KpiCard size="compact" label="Shipments" value={42} icon={Truck} tone="info" />
          <KpiCard size="compact" label="Countries" value={6} icon={Globe} tone="muted" />
        </div>
      </Section>

      <Section title={t("businessComponents.infoSection")}>
        <DetailFieldGrid columns={4}>
          <DetailField label="Tax Number" value={<span className="num">310123456700003</span>} />
          <DetailField label="Payment Terms" value="Net 30" />
          <DetailField label="Account Manager" value="Sara Al-Amin" />
          <DetailField label="Since" value={<span className="num">2024</span>} />
        </DetailFieldGrid>
      </Section>

      <Section title={t("businessComponents.summaryCard")}>
        <DocumentTotalsBlock
          currency="USD"
          lines={[
            { key: "subtotal", label: "Subtotal", value: 4200 },
            { key: "tax", label: "Tax", value: 630 },
          ]}
          total={{ key: "total", label: "Total", value: 4830 }}
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
