"use client";

import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { statusColumn } from "@/config/master-data/shared-columns";
import { formatMoney } from "@/lib/money";
import type { InvestorRow } from "@/services/investors-service";
import type { MessageKey } from "@/i18n/translate";

function InvestorNameCell({ row }: { row: InvestorRow }) {
  return <StackedCell primary={row.name} secondary={row.phone ?? row.email ?? undefined} />;
}

export function buildInvestorsColumns(
  t: (key: MessageKey) => string,
): ColumnDef<InvestorRow, unknown>[] {
  return [
    {
      id: "name",
      meta: { titleKey: "investors.list.fields.name" },
      accessorFn: (row) => row.name,
      cell: ({ row }) => <InvestorNameCell row={row.original} />,
    },
    {
      id: "entityType",
      meta: { titleKey: "investors.list.fields.entityType" },
      accessorFn: (row) => t(`investors.list.entityType.${row.entityType}` as MessageKey),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "investorType",
      meta: { titleKey: "investors.list.fields.investorType" },
      accessorFn: (row) => row.investorType?.name ?? "—",
      cell: (info) => info.getValue() as string,
    },
    {
      id: "email",
      meta: { titleKey: "investors.list.fields.email" },
      accessorFn: (row) => row.email ?? "—",
      cell: (info) => info.getValue() as string,
    },
    {
      id: "activeInvestmentsCount",
      meta: { titleKey: "investors.list.fields.activeInvestmentsCount" },
      accessorFn: (row) => row.activeInvestmentsCount,
      cell: (info) => info.getValue() as number,
    },
    {
      id: "totalConfirmedFunding",
      meta: { titleKey: "investors.list.fields.totalConfirmedFunding" },
      accessorFn: (row) => row.totalConfirmedFunding,
      cell: (info) => formatMoney(info.getValue() as number),
    },
    statusColumn<InvestorRow>(),
  ];
}

export const investorsExportColumns = ["name", "entityType", "phone", "email", "status"];

export const investorRowLabel = (row: InvestorRow) => row.name;

export const investorSchema = z.object({
  name: z.string().min(1),
  entityType: z.enum(["PERSON", "ORGANIZATION"]).optional(),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  commercialRegistration: z.string().optional().or(z.literal("")),
  nationalId: z.string().optional().or(z.literal("")),
  residencyId: z.string().optional().or(z.literal("")),
  iban: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  investorTypeId: z.string().optional().or(z.literal("")),
});

export const investorDefaultValues = {
  name: "",
  entityType: "ORGANIZATION" as const,
  phone: "",
  email: "",
  commercialRegistration: "",
  nationalId: "",
  residencyId: "",
  iban: "",
  notes: "",
  status: "ACTIVE" as const,
  investorTypeId: "",
};
