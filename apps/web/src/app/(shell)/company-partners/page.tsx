"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarCheck,
  FileText,
  HandCoins,
  Handshake,
  Percent,
  Scale,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { InsightCard, InsightGroup } from "@/components/shared/insight-card";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { RowActionsMenu } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { percentText } from "@/config/company-partners/format";
import {
  companyPartnersService,
  type CompanyPartnerRow,
} from "@/services/company-partners-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage } from "@/lib/toast";
import { AddPartnerDialog, PaymentDialog } from "./_components/partner-dialogs";

function CompanyPartnersContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("company-partners.manage");
  const canPay = hasPermission("company-partners.pay");
  const [rows, setRows] = useState<CompanyPartnerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [paying, setPaying] = useState<CompanyPartnerRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRows(await companyPartnersService.list());
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const sum = (pick: (row: CompanyPartnerRow) => number) =>
      Math.round(rows.reduce((s, row) => s + pick(row), 0) * 100) / 100;
    return {
      active: rows.filter((row) => row.status === "ACTIVE").length,
      share:
        Math.round(
          rows.reduce((s, row) => s + (row.currentAgreement?.profitSharePercent ?? 0), 0) * 10_000,
        ) / 10_000,
      approved: sum((row) => row.approved),
      paid: sum((row) => row.paid),
      payable: sum((row) => row.payable),
      advance: sum((row) => row.advance),
    };
  }, [rows]);
  const poolFrequency =
    rows.find((row) => row.currentAgreement)?.currentAgreement?.frequency ?? "MONTHLY";

  const columns = useMemo<ColumnDef<CompanyPartnerRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.name,
        meta: {
          titleKey: "companyPartners.fields.partner",
          type: "name",
          identity: true,
          importance: "critical",
        },
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "partnerNumber",
        accessorFn: (row) => row.partnerNumber,
        meta: { titleKey: "companyPartners.fields.partnerNumber", type: "code", importance: "low" },
      },
      {
        id: "share",
        accessorFn: (row) => row.currentAgreement?.profitSharePercent ?? null,
        meta: {
          titleKey: "companyPartners.fields.profitShare",
          type: "percent",
          importance: "critical",
          displayValue: (row) => percentText(row.currentAgreement?.profitSharePercent),
        },
        cell: ({ row }) =>
          row.original.currentAgreement ? (
            <span className="num">
              {percentText(row.original.currentAgreement.profitSharePercent)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "basis",
        accessorFn: (row) => row.currentAgreement?.basis ?? "",
        meta: {
          titleKey: "companyPartners.fields.basis",
          type: "default",
          importance: "medium",
          displayValue: (row, tr) =>
            row.currentAgreement ? tr(`companyPartners.basis.${row.currentAgreement.basis}`) : "—",
        },
        cell: ({ row }) =>
          row.original.currentAgreement
            ? t(`companyPartners.basis.${row.original.currentAgreement.basis}`)
            : "—",
      },
      {
        id: "ownership",
        accessorFn: (row) => row.ownershipPercent,
        meta: {
          titleKey: "companyPartners.fields.ownershipPercent",
          type: "percent",
          importance: "low",
          displayValue: (row) => percentText(row.ownershipPercent),
        },
        cell: ({ row }) => (
          <span className="num">{percentText(row.original.ownershipPercent)}</span>
        ),
      },
      {
        id: "approved",
        accessorFn: (row) => row.approved,
        meta: { titleKey: "companyPartners.fields.approved", type: "money", importance: "high" },
        cell: ({ row }) => <ReportMoney value={row.original.approved} />,
      },
      {
        id: "paid",
        accessorFn: (row) => row.paid,
        meta: { titleKey: "companyPartners.fields.paid", type: "money", importance: "medium" },
        cell: ({ row }) => <ReportMoney value={row.original.paid} />,
      },
      {
        id: "payable",
        accessorFn: (row) => row.payable,
        meta: { titleKey: "companyPartners.fields.payable", type: "money", importance: "critical" },
        cell: ({ row }) => <ReportMoney value={row.original.payable} />,
      },
      {
        id: "advance",
        accessorFn: (row) => row.advance,
        meta: { titleKey: "companyPartners.fields.advance", type: "money", importance: "medium" },
        cell: ({ row }) => (
          <ReportMoney value={row.original.advance} adverse={row.original.advance > 0} />
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        meta: {
          titleKey: "companyPartners.fields.status",
          type: "status",
          displayValue: (row, tr) => tr(`companyPartners.partnerStatus.${row.status}`),
        },
        cell: ({ row }) => (
          <StatusBadge
            label={t(`companyPartners.partnerStatus.${row.original.status}`)}
            tone={row.original.status === "ACTIVE" ? "success" : "neutral"}
          />
        ),
      },
      {
        id: "actions",
        meta: { type: "actions" },
        cell: ({ row }) => (
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "statement",
                label: t("companyPartners.actions.openStatement"),
                icon: FileText,
                onSelect: () => router.push(`/company-partners/${row.original.partnerId}`),
              },
              {
                key: "pay",
                label: t("companyPartners.actions.recordPayment"),
                icon: Wallet,
                hidden: !canPay,
                onSelect: () => setPaying(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [t, router, canPay],
  );

  return (
    <PageWorkspace
      dense
      title={t("companyPartners.title")}
      description={t("companyPartners.description")}
      actions={
        <HeaderActions
          primary={{
            key: "add",
            label: t("companyPartners.addPartner"),
            icon: UserPlus,
            hidden: !canManage,
            onSelect: () => setAddOpen(true),
          }}
          secondary={[
            {
              key: "periods",
              label: t("companyPartners.periodsLink"),
              icon: CalendarCheck,
              href: "/company-partners/periods",
            },
          ]}
        />
      }
    >
      <InsightGroup className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <InsightCard
          icon={Users}
          label={t("companyPartners.summary.partners")}
          value={totals.active}
          tone="info"
        />
        <InsightCard
          icon={Percent}
          label={t("companyPartners.summary.shareInForce")}
          value={percentText(totals.share)}
          amount={totals.share}
          tone="profit"
        />
        <InsightCard
          icon={Handshake}
          label={t("companyPartners.summary.approved")}
          value={<ReportMoney value={totals.approved} align="inline" />}
          amount={totals.approved}
          tone="profit"
        />
        <InsightCard
          icon={HandCoins}
          label={t("companyPartners.summary.paid")}
          value={<ReportMoney value={totals.paid} align="inline" />}
          amount={totals.paid}
          tone="success"
        />
        <InsightCard
          icon={Scale}
          label={t("companyPartners.summary.payable")}
          value={<ReportMoney value={totals.payable} align="inline" />}
          amount={totals.payable}
          tone="warning"
        />
        <InsightCard
          icon={Wallet}
          label={t("companyPartners.summary.advance")}
          value={<ReportMoney value={totals.advance} align="inline" />}
          amount={totals.advance}
          tone="destructive"
        />
      </InsightGroup>

      <EnterpriseDataTable
        tableId="company-partners"
        printTitle={t("companyPartners.title")}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        emptyTitle={t("companyPartners.empty")}
        getRowId={(row) => row.partnerId}
        getRowHref={(row) => `/company-partners/${row.partnerId}`}
      />

      <AddPartnerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultFrequency={poolFrequency}
        onSaved={(partnerId) => {
          setAddOpen(false);
          router.push(`/company-partners/${partnerId}`);
        }}
      />
      <PaymentDialog
        partner={paying}
        onOpenChange={(open) => {
          if (!open) setPaying(null);
        }}
        onSaved={() => {
          setPaying(null);
          void load();
        }}
      />
    </PageWorkspace>
  );
}

export default function CompanyPartnersPage() {
  return (
    <PermissionGate permission="company-partners.view">
      <CompanyPartnersContent />
    </PermissionGate>
  );
}
