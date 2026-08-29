"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, UserCircle, Truck, User } from "lucide-react";
import { CommandItem } from "@/components/ui/command";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import {
  partnersService,
  type PartnerRoleValue,
  type PartnerRow,
} from "@/services/partners-service";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { PartnerQuickCreateDialog } from "./partner-quick-create-dialog";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/translate";

const ROLE_ICON: Record<PartnerRoleValue, typeof UserCircle> = {
  CUSTOMER: UserCircle,
  SUPPLIER: Truck,
  EMPLOYEE: User,
  OWNER: User,
  OTHER: User,
};

const ROLE_TEXT: Record<
  PartnerRoleValue,
  {
    select: MessageKey;
    placeholder: MessageKey;
    noResults: MessageKey;
    recent: MessageKey;
    quickCreate: MessageKey;
    storageKey: string;
  }
> = {
  CUSTOMER: {
    select: "sales.customers.picker.selectCustomer",
    placeholder: "sales.customers.picker.placeholder",
    noResults: "sales.customers.picker.noResults",
    recent: "sales.customers.picker.recent",
    quickCreate: "sales.customers.picker.quickCreate",
    storageKey: STORAGE_KEYS.recentCustomers,
  },
  SUPPLIER: {
    select: "purchasing.suppliers.picker.selectSupplier",
    placeholder: "purchasing.suppliers.picker.placeholder",
    noResults: "purchasing.suppliers.picker.noResults",
    recent: "purchasing.suppliers.picker.recent",
    quickCreate: "purchasing.suppliers.picker.quickCreate",
    storageKey: STORAGE_KEYS.recentSuppliers,
  },
  EMPLOYEE: {
    select: "partners.picker.selectPartner",
    placeholder: "partners.picker.placeholder",
    noResults: "partners.picker.noResults",
    recent: "partners.picker.recent",
    quickCreate: "partners.picker.quickCreate",
    storageKey: "oms.partners.recentEmployees",
  },
  OWNER: {
    select: "partners.picker.selectPartner",
    placeholder: "partners.picker.placeholder",
    noResults: "partners.picker.noResults",
    recent: "partners.picker.recent",
    quickCreate: "partners.picker.quickCreate",
    storageKey: "oms.partners.recentOwners",
  },
  OTHER: {
    select: "partners.picker.selectPartner",
    placeholder: "partners.picker.placeholder",
    noResults: "partners.picker.noResults",
    recent: "partners.picker.recent",
    quickCreate: "partners.picker.quickCreate",
    storageKey: "oms.partners.recentOther",
  },
};

/**
 * Unified Partner Architecture — one role-aware picker for every
 * counterparty selector in Sales/Purchasing/Journal Entries (replaces
 * `CustomerPicker`/`SupplierPicker`). Search is filtered to Partners holding
 * `role` server-side; Quick Create always assigns that same role.
 */
export function PartnerPicker({
  role,
  value,
  onChange,
  disabled,
  className,
}: {
  role: PartnerRoleValue;
  value: PartnerRow | null | undefined;
  onChange: (partner: PartnerRow) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const text = ROLE_TEXT[role];
  const Icon = ROLE_ICON[role];
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(text.storageKey, []);
  const [recentPartners, setRecentPartners] = useState<PartnerRow[]>([]);

  useEffect(() => {
    if (recentIds.length === 0) return;
    let cancelled = false;
    const loadRecent = async () => {
      const rows = await Promise.all(
        recentIds.slice(0, 5).map((id) => partnersService.get(id).catch(() => null)),
      );
      if (!cancelled) {
        setRecentPartners(rows.filter((row): row is PartnerRow => !!row));
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [recentIds]);

  const selectPartner = (partner: PartnerRow) => {
    onChange(partner);
    setRecentIds((previous) =>
      [partner.id, ...previous.filter((id) => id !== partner.id)].slice(0, 5),
    );
  };

  const subtitle = useMemo(
    () => (partner: PartnerRow) =>
      [partner.partnerNumber, partner.phone || partner.mobile || partner.email]
        .filter(Boolean)
        .join(" · "),
    [],
  );

  return (
    <>
      <EntityCombobox
        value={value ?? null}
        onChange={(partner) => {
          if (partner) selectPartner(partner);
        }}
        onSearch={async (search) => {
          const result = await partnersService.list({
            search: search || undefined,
            pageSize: 8,
            role: [role],
          });
          return result.items;
        }}
        getId={(partner) => partner.id}
        getTitle={(partner) => partner.name}
        getSubtitle={subtitle}
        subtitleDir="ltr"
        placeholder={t(text.select)}
        searchPlaceholder={t(text.placeholder)}
        emptyText={t(text.noResults)}
        disabled={disabled}
        icon={<Icon className="size-3.5 shrink-0 text-muted-foreground" />}
        triggerClassName={cn("max-w-(--width-picker-customer)", className)}
        groups={
          recentIds.length > 0 && recentPartners.length
            ? [{ heading: t(text.recent), items: recentPartners }]
            : undefined
        }
        footer={
          <CommandItem value="__quick_create__" onSelect={() => setQuickCreateOpen(true)}>
            <Plus className="size-4" />
            {t(text.quickCreate)}
          </CommandItem>
        }
      />
      <PartnerQuickCreateDialog
        role={role}
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        onCreated={selectPartner}
      />
    </>
  );
}
