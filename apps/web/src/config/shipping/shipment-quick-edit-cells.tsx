"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { useLocale } from "@/providers/locale-provider";
import { storeOrdersService } from "@/services/store-orders-service";
import { shipmentStatusLabelKey, shipmentStatusTone, catalogStatusTone } from "./shipment-status";
import type { ShipmentListRow, ShippingStatusCatalogEntry } from "@/services/shipping-service";
import type { ShippingCompanyOption } from "@/services/shipping-companies-service";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

export type SaveState = "idle" | "saving" | "saved";

/** Subtle inline feedback for a quick-edit save — never a toast per Part 8 (no success-toast spam). */
function SavingIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
    );
  }
  if (state === "saved") {
    return <Check className="size-3 shrink-0 text-success" />;
  }
  return null;
}

function useSaveState() {
  const [state, setState] = useState<SaveState>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const markSaved = () => {
    setState("saved");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setState("idle"), 1500);
  };

  return { state, setState, markSaved };
}

export interface ShipmentQuickEditContext {
  canEdit: boolean;
  statuses: ShippingStatusCatalogEntry[];
  companies: ShippingCompanyOption[];
  onPatched: (shipmentId: string, patch: Partial<ShipmentListRow>) => void;
}

/**
 * Inline Shipping Status cell — the direct "change to any status" catalog
 * picker (same canonical operation `ShipmentManageDialog` already uses),
 * never a hardcoded status list. Read-only badge when the viewer lacks
 * `shipping.edit` or the catalog hasn't loaded yet.
 */
export function ShippingStatusQuickCell({
  row,
  ctx,
}: {
  row: ShipmentListRow;
  ctx: ShipmentQuickEditContext;
}) {
  const { t } = useLocale();
  const { state, setState, markSaved } = useSaveState();
  const currentId = row.shippingStatus?.id ?? "";

  const badge = (
    <StatusBadge
      label={row.shippingStatus?.name ?? t(shipmentStatusLabelKey(row.status))}
      tone={
        row.shippingStatus
          ? catalogStatusTone(row.shippingStatus.color)
          : shipmentStatusTone(row.status)
      }
    />
  );

  if (!ctx.canEdit || !row.isCurrentAttempt || ctx.statuses.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        {badge}
        {row.attemptNumber > 1 && (
          <EnterpriseBadge variant="outline" className="text-xs">
            #{row.attemptNumber}
          </EnterpriseBadge>
        )}
      </div>
    );
  }

  const handleChange = async (nextId: string) => {
    if (!nextId || nextId === currentId) return;
    const next = ctx.statuses.find((status) => status.id === nextId);
    setState("saving");
    try {
      const updated = await storeOrdersService.shipments.setShippingStatus(
        row.storeOrderId,
        nextId,
      );
      ctx.onPatched(row.id, {
        status: updated.status,
        shippingStatus: next
          ? {
              id: next.id,
              code: next.code,
              name: next.label,
              color: next.color,
              syncBehavior: next.syncBehavior,
            }
          : row.shippingStatus,
      });
      markSaved();
    } catch (error) {
      setState("idle");
      toast.error(
        error instanceof ApiError ? error.message : t("shipping.quickEdit.statusChangeFailed"),
      );
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select value={currentId || undefined} onValueChange={(v) => void handleChange(v)}>
        <SelectTrigger
          size="sm"
          className="h-8 max-w-44 border-transparent bg-transparent px-1.5 shadow-none not-disabled:hover:border-border not-disabled:hover:bg-muted/40"
        >
          {badge}
        </SelectTrigger>
        <SelectContent>
          {ctx.statuses.map((status) => (
            <SelectItem key={status.id} value={status.id}>
              {status.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {row.attemptNumber > 1 && (
        <EnterpriseBadge variant="outline" className="text-xs">
          #{row.attemptNumber}
        </EnterpriseBadge>
      )}
      <SavingIndicator state={state} />
    </div>
  );
}

/** Inline Shipping Company cell — compact searchable combobox over the canonical, active-only ShippingCompany master data. */
export function ShippingCompanyQuickCell({
  row,
  ctx,
}: {
  row: ShipmentListRow;
  ctx: ShipmentQuickEditContext;
}) {
  const { t } = useLocale();
  const { state, setState, markSaved } = useSaveState();

  if (!ctx.canEdit || !row.isCurrentAttempt) {
    return <span>{row.shippingCompany?.name ?? "—"}</span>;
  }

  const selected = row.shippingCompanyId
    ? (ctx.companies.find((company) => company.id === row.shippingCompanyId) ?? {
        id: row.shippingCompanyId,
        name: row.shippingCompany?.name ?? "—",
      })
    : null;

  const handleChange = async (company: ShippingCompanyOption | null) => {
    if (!company || company.id === row.shippingCompanyId) return;
    setState("saving");
    try {
      await storeOrdersService.shipments.setShippingCompany(row.storeOrderId, row.id, company.id);
      ctx.onPatched(row.id, { shippingCompanyId: company.id, shippingCompany: company });
      markSaved();
    } catch (error) {
      setState("idle");
      toast.error(
        error instanceof ApiError ? error.message : t("shipping.quickEdit.companyChangeFailed"),
      );
    }
  };

  return (
    <div className="flex max-w-48 items-center gap-1.5">
      <EntityCombobox
        items={ctx.companies}
        value={selected}
        onChange={(company) => void handleChange(company)}
        getId={(company) => company.id}
        getTitle={(company) => company.name}
        placeholder={t("shipping.quickEdit.selectCompanyPlaceholder")}
        searchPlaceholder={t("common.search")}
        triggerClassName="h-8 border-transparent bg-transparent px-2 shadow-none not-disabled:hover:border-border not-disabled:hover:bg-muted/40"
      />
      <SavingIndicator state={state} />
    </div>
  );
}

/** Inline Tracking Number cell — click to edit, Enter/blur saves, Escape cancels. Never navigates the row. */
export function TrackingNumberQuickCell({
  row,
  ctx,
}: {
  row: ShipmentListRow;
  ctx: ShipmentQuickEditContext;
}) {
  const { t } = useLocale();
  const { state, setState, markSaved } = useSaveState();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(row.trackingNumber ?? "");

  useEffect(() => {
    if (!isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(row.trackingNumber ?? "");
    }
  }, [row.trackingNumber, isEditing]);

  if (!ctx.canEdit || !row.isCurrentAttempt) {
    return row.trackingNumber ? (
      <SemanticValue kind="id">{row.trackingNumber}</SemanticValue>
    ) : (
      <span className="text-muted-foreground">{t("shipping.quickEdit.trackingEmpty")}</span>
    );
  }

  const save = async () => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (trimmed === (row.trackingNumber ?? "")) return;
    if (!trimmed) {
      setDraft(row.trackingNumber ?? "");
      return;
    }
    setState("saving");
    try {
      await storeOrdersService.shipments.setTrackingNumber(row.storeOrderId, row.id, trimmed);
      ctx.onPatched(row.id, { trackingNumber: trimmed });
      markSaved();
    } catch (error) {
      setDraft(row.trackingNumber ?? "");
      setState("idle");
      toast.error(
        error instanceof ApiError ? error.message : t("shipping.quickEdit.trackingChangeFailed"),
      );
    }
  };

  if (isEditing) {
    return (
      <Input
        autoFocus
        dir="ltr"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(row.trackingNumber ?? "");
            setIsEditing(false);
          }
        }}
        placeholder={t("shipping.quickEdit.trackingPlaceholder")}
        className="h-8 max-w-40"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="flex h-8 max-w-40 items-center gap-1.5 rounded-xs px-2 text-start hover:bg-muted/40"
    >
      {row.trackingNumber ? (
        <SemanticValue kind="id">{row.trackingNumber}</SemanticValue>
      ) : (
        <span className="text-muted-foreground">{t("shipping.quickEdit.trackingPlaceholder")}</span>
      )}
      <SavingIndicator state={state} />
    </button>
  );
}
