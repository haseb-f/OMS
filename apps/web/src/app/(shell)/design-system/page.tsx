"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bell,
  Boxes,
  Building2,
  Calculator,
  Globe,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
} from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardFooter,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { EnterpriseBadge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { FadeInStagger, FadeInItem } from "@/components/shared/fade-in";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { navigationConfig } from "@/navigation/navigation.config";
import { iconRegistry } from "@/navigation/icon-registry";
import { useLocale } from "@/providers/locale-provider";

/** Sample rows for the Tables section — clearly-labeled placeholder data, not a real business dataset. */
interface SampleRow {
  id: string;
  name: string;
  status: "active" | "draft";
}

const sampleRows: SampleRow[] = [
  { id: "1", name: "Sample Row 1", status: "active" },
  { id: "2", name: "Sample Row 2", status: "draft" },
  { id: "3", name: "Sample Row 3", status: "active" },
];

const radiusSwatches = [
  { label: "8", className: "rounded-sm" },
  { label: "12", className: "rounded-md" },
  { label: "16", className: "rounded-lg" },
  { label: "20", className: "rounded-xl" },
  { label: "24", className: "rounded-2xl" },
  { label: "30", className: "rounded-3xl" },
];

const shadowSwatches = [
  { label: "xs", className: "shadow-xs" },
  { label: "sm", className: "shadow-sm" },
  { label: "md", className: "shadow-md" },
  { label: "lg", className: "shadow-lg" },
  { label: "xl", className: "shadow-xl" },
  { label: "2xl", className: "shadow-2xl" },
];

const spacingSwatches = [8, 12, 16, 24, 32];

const colorSwatches = [
  { label: "Primary (Navy)", className: "bg-primary" },
  { label: "Secondary", className: "bg-secondary" },
  { label: "Success", className: "bg-success" },
  { label: "Warning", className: "bg-warning" },
  { label: "Destructive", className: "bg-destructive" },
  { label: "Muted", className: "bg-muted border" },
  { label: "Border", className: "bg-border" },
  { label: "Foreground", className: "bg-foreground" },
];

const iconSamples = [
  { name: "layout-dashboard", icon: Globe },
  { name: "users", icon: Users },
  { name: "shopping-cart", icon: ShoppingCart },
  { name: "package", icon: Package },
  { name: "boxes", icon: Boxes },
  { name: "calculator", icon: Calculator },
  { name: "building", icon: Building2 },
  { name: "shield-check", icon: ShieldCheck },
  { name: "bell", icon: Bell },
  { name: "settings", icon: Settings },
];

const topLevelNavItems = navigationConfig.filter((item) => !item.parent);

export default function DesignSystemPage() {
  const { t } = useLocale();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  const [loadingVisible, setLoadingVisible] = useState(false);

  const columns: ColumnDef<SampleRow, unknown>[] = [
    {
      id: "name",
      meta: { titleKey: "masterData.fields.name" },
      accessorFn: (row) => row.name,
    },
    {
      id: "status",
      meta: { titleKey: "common.status" },
      accessorFn: (row) => row.status,
      cell: ({ row }) => (
        <EnterpriseBadge variant={row.original.status === "active" ? "default" : "secondary"}>
          {row.original.status}
        </EnterpriseBadge>
      ),
    },
  ];

  return (
    <PageWorkspace title={t("designSystem.title")} description={t("designSystem.subtitle")}>
      <div className="flex flex-col gap-10 pb-16">
        {/* Typography */}
        <Section title={t("designSystem.typography")}>
          <EnterpriseCard>
            <EnterpriseCardContent className="flex flex-col gap-4">
              <p className="text-display">Display 40</p>
              <p className="text-page-title">Page Title 30</p>
              <p className="text-section-title">Section 22</p>
              <p className="text-card-title">EnterpriseCard Title 18</p>
              <p className="text-body">Body 15 — the default reading size across OMS.</p>
              <p className="text-caption text-muted-foreground">Caption 13</p>
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>

        {/* Colors */}
        <Section title={t("designSystem.colors")}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {colorSwatches.map((swatch) => (
              <div key={swatch.label} className="flex flex-col gap-2">
                <div className={`h-16 rounded-lg ${swatch.className}`} />
                <span className="text-caption text-muted-foreground">{swatch.label}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Buttons */}
        <Section title={t("designSystem.buttons")}>
          <EnterpriseCard>
            <EnterpriseCardContent className="flex flex-wrap items-center gap-3">
              <EnterpriseButton>{t("designSystem.primaryButton")}</EnterpriseButton>
              <EnterpriseButton variant="secondary">
                {t("designSystem.secondaryButton")}
              </EnterpriseButton>
              <EnterpriseButton variant="outline">
                {t("designSystem.outlineButton")}
              </EnterpriseButton>
              <EnterpriseButton variant="ghost">{t("designSystem.ghostButton")}</EnterpriseButton>
              <EnterpriseButton variant="destructive">
                {t("designSystem.destructiveButton")}
              </EnterpriseButton>
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>

        {/* Inputs */}
        <Section title={t("designSystem.inputs")}>
          <EnterpriseCard>
            <EnterpriseCardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Input</Label>
                <Input placeholder="Placeholder…" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Select</Label>
                <Select defaultValue="one">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one">Option one</SelectItem>
                    <SelectItem value="two">Option two</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Textarea</Label>
                <Textarea placeholder="Placeholder…" />
              </div>
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>

        {/* Cards + KPI cards */}
        <Section title={t("designSystem.cards")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <EnterpriseCard>
              <EnterpriseCardHeader>
                <EnterpriseCardTitle>{t("designSystem.sampleCardTitle")}</EnterpriseCardTitle>
              </EnterpriseCardHeader>
              <EnterpriseCardContent>
                <p className="text-body text-muted-foreground">
                  {t("designSystem.sampleCardDescription")}
                </p>
              </EnterpriseCardContent>
              <EnterpriseCardFooter>
                <EnterpriseButton size="sm" variant="outline">
                  {t("designSystem.sampleCardFooterAction")}
                </EnterpriseButton>
              </EnterpriseCardFooter>
            </EnterpriseCard>
            <KpiCard icon={ShoppingCart} label="KPI Label" value={128} tone="success" />
          </div>
        </Section>

        {/* Tables */}
        <Section title={t("designSystem.tables")}>
          <EnterpriseDataTable tableId="design-system-sample" columns={columns} data={sampleRows} />
        </Section>

        {/* Dialogs */}
        <Section title={t("designSystem.dialogs")}>
          <EnterpriseCard>
            <EnterpriseCardContent className="flex flex-wrap gap-3">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <EnterpriseButton variant="outline">
                    {t("designSystem.dialogTrigger")}
                  </EnterpriseButton>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("designSystem.dialogTitle")}</DialogTitle>
                    <DialogDescription>{t("designSystem.dialogDescription")}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <EnterpriseButton onClick={() => setDialogOpen(false)}>
                      {t("common.confirm")}
                    </EnterpriseButton>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <EnterpriseButton variant="outline" onClick={() => setConfirmOpen(true)}>
                {t("designSystem.alertDialogTrigger")}
              </EnterpriseButton>
              <ConfirmationDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={t("designSystem.dialogTitle")}
                description={t("designSystem.dialogDescription")}
                onConfirm={() => setConfirmOpen(false)}
              />
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>

        {/* Sidebar & Topbar reference */}
        <Section title={t("designSystem.sidebarTopbar")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <EnterpriseCard className="bg-none bg-sidebar text-sidebar-foreground">
              <EnterpriseCardContent>
                <p className="text-body">{t("designSystem.sidebarPreviewNote")}</p>
              </EnterpriseCardContent>
            </EnterpriseCard>
            <EnterpriseCard>
              <EnterpriseCardContent>
                <p className="text-body text-muted-foreground">
                  {t("designSystem.topbarPreviewNote")}
                </p>
              </EnterpriseCardContent>
            </EnterpriseCard>
          </div>
        </Section>

        {/* Navigation */}
        <Section title={t("designSystem.navigation")}>
          <EnterpriseCard className="max-w-xs bg-none bg-sidebar text-sidebar-foreground">
            <EnterpriseCardContent className="flex flex-col gap-1">
              {topLevelNavItems.slice(0, 6).map((item) => {
                const Icon = item.icon ? iconRegistry[item.icon] : null;
                return (
                  <div
                    key={item.id}
                    className="flex h-11 items-center gap-3 rounded-md px-3 text-body hover:bg-sidebar-accent"
                  >
                    {Icon && <Icon className="size-[22px]" />}
                    <span>{t(item.titleKey)}</span>
                  </div>
                );
              })}
            </EnterpriseCardContent>
          </EnterpriseCard>
          <p className="text-caption text-muted-foreground">{t("designSystem.navigationNote")}</p>
        </Section>

        {/* Loading states */}
        <Section title={t("designSystem.loadingStates")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <EnterpriseCard>
              <EnterpriseCardContent className="flex flex-col gap-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </EnterpriseCardContent>
            </EnterpriseCard>
            <EnterpriseCard className="relative overflow-hidden">
              <EnterpriseCardContent className="flex min-h-32 flex-col gap-3">
                <EnterpriseButton
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    setLoadingVisible(true);
                    setTimeout(() => setLoadingVisible(false), 1500);
                  }}
                >
                  {t("designSystem.loadingOverlayTrigger")}
                </EnterpriseButton>
              </EnterpriseCardContent>
              {loadingVisible && <LoadingOverlay />}
            </EnterpriseCard>
          </div>
        </Section>

        {/* Empty states */}
        <Section title={t("designSystem.emptyStates")}>
          <EnterpriseCard>
            <EnterpriseCardContent>
              <EmptyState
                icon={Boxes}
                title={t("designSystem.emptyStateTitle")}
                description={t("designSystem.emptyStateDescription")}
                action={
                  <EnterpriseButton size="sm">
                    {t("designSystem.emptyStateAction")}
                  </EnterpriseButton>
                }
              />
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>

        {/* Icons */}
        <Section title={t("designSystem.icons")}>
          <EnterpriseCard>
            <EnterpriseCardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {iconSamples.map(({ name, icon: Icon }) => (
                <div key={name} className="flex flex-col items-center gap-2">
                  <Icon className="size-[22px] text-foreground" />
                  <span className="text-caption text-muted-foreground">{name}</span>
                </div>
              ))}
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>

        {/* Spacing */}
        <Section title={t("designSystem.spacing")}>
          <EnterpriseCard>
            <EnterpriseCardContent className="flex flex-wrap items-end gap-4">
              {spacingSwatches.map((size) => (
                <div key={size} className="flex flex-col items-center gap-2">
                  <div className="bg-primary" style={{ width: size, height: size }} />
                  <span className="text-caption text-muted-foreground">{size}</span>
                </div>
              ))}
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>

        {/* Shadows */}
        <Section title={t("designSystem.shadows")}>
          <div className="grid grid-cols-3 gap-6 sm:grid-cols-6">
            {shadowSwatches.map((swatch) => (
              <div key={swatch.label} className="flex flex-col items-center gap-2">
                <div className={`size-14 rounded-lg bg-card ${swatch.className}`} />
                <span className="text-caption text-muted-foreground">{swatch.label}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Radius */}
        <Section title={t("designSystem.radius")}>
          <div className="grid grid-cols-3 gap-6 sm:grid-cols-6">
            {radiusSwatches.map((swatch) => (
              <div key={swatch.label} className="flex flex-col items-center gap-2">
                <div className={`size-14 border-2 border-primary ${swatch.className}`} />
                <span className="text-caption text-muted-foreground">{swatch.label}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Animations */}
        <Section title={t("designSystem.animations")}>
          <EnterpriseCard>
            <EnterpriseCardContent className="flex flex-col gap-4">
              <EnterpriseButton
                variant="outline"
                className="self-start"
                onClick={() => setAnimationKey((key) => key + 1)}
              >
                {t("designSystem.animationTrigger")}
              </EnterpriseButton>
              <FadeInStagger key={animationKey} className="flex gap-4">
                {[0, 1, 2].map((index) => (
                  <FadeInItem key={index}>
                    <div className="flex size-16 items-center justify-center rounded-lg bg-primary/10 text-caption text-primary">
                      180ms
                    </div>
                  </FadeInItem>
                ))}
              </FadeInStagger>
            </EnterpriseCardContent>
          </EnterpriseCard>
        </Section>
      </div>
    </PageWorkspace>
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
