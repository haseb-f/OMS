"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, ChevronRight, MapPin, Pencil, Plus, RotateCcw } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { warehouseLocationsService } from "@/services/warehouse-locations-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { WarehouseLocationRow, WarehouseRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";
import { RowActionsMenu } from "@/components/shared/data-table";
import { useUserContext } from "@/providers/user-context";

const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

interface TreeNode extends WarehouseLocationRow {
  children: TreeNode[];
}

function buildTree(locations: WarehouseLocationRow[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(
    locations.map((location) => [location.id, { ...location, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentLocationId && nodes.has(node.parentLocationId)) {
      nodes.get(node.parentLocationId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

interface FormState {
  name: string;
  description: string;
  isActive: boolean;
}

const emptyForm: FormState = { name: "", description: "", isActive: true };

function WarehouseLocationsPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission("masterdata.warehouse-locations.create");
  const canEdit = hasPermission("masterdata.warehouse-locations.edit");
  const canArchive = hasPermission("masterdata.warehouse-locations.archive");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [locations, setLocations] = useState<WarehouseLocationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<WarehouseLocationRow | null>(null);
  const [parentForNew, setParentForNew] = useState<WarehouseLocationRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<WarehouseLocationRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<WarehouseLocationRow | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  useEffect(() => {
    warehousesService
      .list({ pageSize: 200 })
      .then((result) => {
        setWarehouses(result.items);
        if (result.items.length > 0) setWarehouseId((current) => current || result.items[0].id);
      })
      .catch(() => setWarehouses([]));
  }, []);

  const load = useCallback(async () => {
    if (!warehouseId) {
      setLocations([]);
      return;
    }
    setIsLoading(true);
    try {
      const items = await warehouseLocationsService.listByWarehouse(warehouseId);
      setLocations(items);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load locations.");
    } finally {
      setIsLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const tree = useMemo(() => buildTree(locations), [locations]);

  const openCreate = (parent: WarehouseLocationRow | null) => {
    setEditingLocation(null);
    setParentForNew(parent);
    setForm(emptyForm);
    setModalOpen(true);
  };
  const openEdit = (location: WarehouseLocationRow) => {
    setEditingLocation(location);
    setParentForNew(null);
    setForm({
      name: location.name,
      description: location.description ?? "",
      isActive: location.isActive,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error(t("masterData.warehouseLocations.nameRequired"));
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingLocation) {
        await warehouseLocationsService.update(editingLocation.id, {
          name: form.name,
          description: form.description || undefined,
          isActive: form.isActive,
        });
      } else {
        await warehouseLocationsService.create({
          name: form.name,
          description: form.description || undefined,
          isActive: form.isActive,
          warehouseId,
          parentLocationId: parentForNew?.id,
        });
      }
      toast.success(t("common.save"));
      setModalOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setIsMutating(true);
    try {
      await warehouseLocationsService.archive(archiveTarget.id);
      toast.success(t("common.archive"));
      setArchiveTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive.");
    } finally {
      setIsMutating(false);
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    setIsMutating(true);
    try {
      await warehouseLocationsService.restore(restoreTarget.id);
      toast.success(t("common.restore"));
      setRestoreTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to restore.");
    } finally {
      setIsMutating(false);
    }
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isCollapsed = collapsed.has(node.id);
    const isArchived = !!node.deletedAt;
    return (
      <div key={node.id}>
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-transparent px-2 py-2 hover:border-border hover:bg-muted/40"
          style={{ paddingInlineStart: `${depth * 1.75 + 0.5}rem` }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleCollapsed(node.id)}
              className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
              aria-label={isCollapsed ? t("common.expand") : t("common.collapse")}
            >
              {isCollapsed ? (
                <ChevronRight className="size-4 rtl:rotate-180" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{node.name}</span>
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {node.code}
          </code>
          {isArchived && <StatusBadge label={t("common.archived")} tone="neutral" />}
          <div className="ms-auto">
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  key: "edit",
                  label: t("common.edit"),
                  icon: Pencil,
                  hidden: isArchived || !canEdit,
                  onSelect: () => openEdit(node),
                },
                {
                  key: "add-child",
                  label: t("masterData.warehouseLocations.addChild"),
                  icon: Plus,
                  hidden: isArchived || !canCreate,
                  onSelect: () => openCreate(node),
                },
                {
                  key: "archive",
                  label: t("common.archive"),
                  icon: Archive,
                  hidden: isArchived || !canArchive,
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => setArchiveTarget(node),
                },
                {
                  key: "restore",
                  label: t("common.restore"),
                  icon: RotateCcw,
                  hidden: !isArchived || !canArchive,
                  onSelect: () => setRestoreTarget(node),
                },
              ]}
            />
          </div>
        </div>
        {!isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <PageWorkspace
      title={t("masterData.warehouseLocations.title")}
      description={t("masterData.warehouseLocations.description")}
      actions={
        <EnterpriseButton
          type="button"
          onClick={() => openCreate(null)}
          disabled={!warehouseId || !canCreate}
        >
          <Plus />
          {t("masterData.warehouseLocations.addLocation")}
        </EnterpriseButton>
      }
      filters={
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t("masterData.fields.warehouse")} />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="relative rounded-xl border shadow-sm">
        {isMutating && <LoadingOverlay />}
        <div className="min-h-40 p-2">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-caption text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : tree.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title={t("masterData.warehouseLocations.empty")}
              description={
                warehouseId ? undefined : t("masterData.warehouseLocations.selectWarehouse")
              }
            />
          ) : (
            tree.map((node) => renderNode(node, 0))
          )}
        </div>
      </div>

      <EnterpriseModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        size="md"
        icon={MapPin}
        title={editingLocation ? t("common.edit") : t("masterData.warehouseLocations.addLocation")}
        description={
          parentForNew
            ? `${t("masterData.warehouseLocations.parentLocation")}: ${parentForNew.name}`
            : undefined
        }
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" onClick={submit} disabled={isSubmitting}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("masterData.fields.name")} <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="A1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t("masterData.fields.description")}</label>
            <Textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.isActive}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, isActive: !!checked }))
              }
            />
            <label className="text-sm font-medium">{t("masterData.fields.isActive")}</label>
          </div>
        </div>
      </EnterpriseModal>

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t("common.confirmArchiveTitle")}
        description={
          archiveTarget && `${archiveTarget.name} — ${t("common.confirmArchiveDescription")}`
        }
        onConfirm={confirmArchive}
        confirmLabel={t("common.archive")}
      />

      <ConfirmationDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title={t("common.confirmRestoreTitle")}
        description={
          restoreTarget && `${restoreTarget.name} — ${t("common.confirmRestoreDescription")}`
        }
        onConfirm={confirmRestore}
        confirmLabel={t("common.restore")}
      />
    </PageWorkspace>
  );
}

export default function WarehouseLocationsPage() {
  return (
    <PermissionGate permission="masterdata.warehouse-locations.view">
      <WarehouseLocationsPageContent />
    </PermissionGate>
  );
}
