"use client";

import type { ReactNode } from "react";
import { RecordGridCard } from "@/components/shared/data-table";
import type { RecordGridCardField } from "@/components/shared/data-table/record-grid-card";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import { ActiveArchivedBadge } from "@/config/master-data/shared-columns";
import { useLocale } from "@/providers/locale-provider";
import type { PartnerRow } from "@/services/partners-service";
import { RolesCell } from "./partner-columns";

interface PartnerCardProps {
  row: PartnerRow;
  /** Customers and Suppliers share the card; only the group label/value differs. */
  role: "customer" | "supplier";
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
  /** The master-data page's own row-actions menu (same permissions as the table). */
  actionsNode: ReactNode;
}

/**
 * Grid-view template of the Customers and Suppliers lists (round 9). Identity
 * only: name, phone, code, group, location, e-mail, roles and the Active /
 * Archived badge — exactly what the tables show. No balance, credit limit or
 * other financial figure is drawn, so nothing needs a permission of its own.
 */
export function PartnerGridCard({
  row,
  role,
  selected,
  onToggleSelected,
  href,
  actionsNode,
}: PartnerCardProps) {
  const { t } = useLocale();
  const archived = Boolean(row.deletedAt);
  const group =
    role === "customer"
      ? row.customerProfile?.customerGroup?.name
      : row.supplierProfile?.supplierGroup?.name;

  const fields: RecordGridCardField[] = [
    {
      key: "group",
      label: t(
        role === "customer"
          ? "sales.customers.fields.customerGroup"
          : "purchasing.suppliers.fields.supplierGroup",
      ),
      value: group ?? "—",
    },
    { key: "city", label: t("partners.fields.city"), value: row.city ?? "—" },
    { key: "country", label: t("partners.fields.country"), value: row.country?.name ?? "—" },
    {
      key: "email",
      label: t("partners.fields.email"),
      value: row.email ? <SemanticValue kind="email">{row.email}</SemanticValue> : "—",
    },
  ];

  return (
    <RecordGridCard
      tone={archived ? "neutral" : "success"}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: row.name })}
      title={<LocaleText>{row.name}</LocaleText>}
      subtitle={row.phone ? <SemanticValue kind="phone">{row.phone}</SemanticValue> : undefined}
      href={href}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {row.partnerNumber}
        </SemanticValue>
      }
      fields={fields}
      badges={
        <>
          <ActiveArchivedBadge deletedAt={row.deletedAt} />
          <RolesCell roles={row.roles} />
        </>
      }
      actionsNode={actionsNode}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
