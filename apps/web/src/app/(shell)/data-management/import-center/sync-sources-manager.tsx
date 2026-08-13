"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, UploadCloud } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { syncService, type SyncSource, type SyncSourceType } from "@/services/sync-service";
import { importTypesService, type ImportFieldDef } from "@/services/import-types-service";
import { referenceDataService, type ReferenceDataType } from "@/services/reference-data-service";
import { formatDateTime } from "@/lib/date";

const SOURCE_TYPE_TO_IMPORT_TYPE: Record<SyncSourceType, string> = {
  LEADS: "LEADS",
  STORE_ORDERS: "STORE_ORDERS",
  CASH_FLOW: "BANK_TRANSACTIONS",
  SHIPPING_UPDATES: "SHIPPING_UPDATES",
};

/**
 * Data Synchronization source configuration — spreadsheet + column mapping
 * per module (Leads/Store Orders) or per Cash Flow provider tab. Previously
 * API-only; this is the admin UI closing that gap. A field the target
 * import type marks `referenceType` shows a badge here so the admin knows
 * that column must contain a real, active Master Data value (never free
 * text) once synced — validated the same way the Excel Template's dropdown
 * enforces it.
 */
export function SyncSourcesManager({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useLocale();
  const [sources, setSources] = useState<SyncSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  const load = () => {
    setLoading(true);
    syncService
      .listSources()
      .then(setSources)
      .catch((error) =>
        toast.error(error instanceof ApiError ? error.message : "Failed to load sync sources."),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("importCenter.sync.sources.title")}</DialogTitle>
            <DialogDescription>{t("importCenter.sync.sources.description")}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <EnterpriseButton type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t("importCenter.sync.sources.new")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPushOpen(true)}
            >
              <UploadCloud />
              {t("importCenter.sync.sources.pushReferenceData")}
            </EnterpriseButton>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("importCenter.sync.sources.label")}</TableHead>
                  <TableHead>{t("importCenter.sync.sources.type")}</TableHead>
                  <TableHead>{t("importCenter.sync.sources.enabled")}</TableHead>
                  <TableHead>{t("importCenter.sync.lastSync")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>{source.label}</TableCell>
                    <TableCell>{source.sourceType}</TableCell>
                    <TableCell>
                      <EnterpriseBadge variant={source.enabled ? "default" : "outline"}>
                        {source.enabled ? t("common.active") : t("common.archived")}
                      </EnterpriseBadge>
                    </TableCell>
                    <TableCell className="text-caption text-muted-foreground">
                      {source.lastSyncedAt
                        ? formatDateTime(source.lastSyncedAt)
                        : t("importCenter.sync.statusNeverRun")}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && sources.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {t("common.noResults")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <EnterpriseButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </EnterpriseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateSourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <PushReferenceDataDialog open={pushOpen} onOpenChange={setPushOpen} />
    </>
  );
}

function CreateSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const [sourceType, setSourceType] = useState<SyncSourceType>("STORE_ORDERS");
  const [label, setLabel] = useState("");
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [fields, setFields] = useState<ImportFieldDef[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [cashFlowDirection, setCashFlowDirection] = useState<"INCOMING" | "OUTGOING">("INCOMING");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMapping({});
    importTypesService
      .list()
      .then((types) => {
        const def = types.find((t2) => t2.type === SOURCE_TYPE_TO_IMPORT_TYPE[sourceType]);
        setFields(def?.fields ?? []);
      })
      .catch(() => setFields([]));
  }, [open, sourceType]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await syncService.createSource({
        sourceType,
        label,
        spreadsheetUrl,
        columnMapping: mapping,
        ...(sourceType === "CASH_FLOW" ? { configMetadata: { direction: cashFlowDirection } } : {}),
      });
      toast.success(t("importCenter.sync.sources.created"));
      setLabel("");
      setSpreadsheetUrl("");
      onCreated();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to create sync source.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("importCenter.sync.sources.new")}</DialogTitle>
          <DialogDescription>{t("importCenter.sync.sources.newDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("importCenter.sync.sources.type")}</Label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as SyncSourceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LEADS">{t("importCenter.types.leads.label")}</SelectItem>
                  <SelectItem value="STORE_ORDERS">{t("storeOrders.title")}</SelectItem>
                  <SelectItem value="CASH_FLOW">
                    {t("masterData.bankTransactions.title")}
                  </SelectItem>
                  <SelectItem value="SHIPPING_UPDATES">
                    {t("importCenter.types.shippingUpdates.label")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("importCenter.sync.sources.label")}</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Al Rajhi"
              />
            </div>
          </div>

          {sourceType === "CASH_FLOW" && (
            <div className="flex flex-col gap-1.5">
              <Label>{t("masterData.bankTransactions.fields.classification")}</Label>
              <Select
                value={cashFlowDirection}
                onValueChange={(v) => setCashFlowDirection(v as "INCOMING" | "OUTGOING")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INCOMING">
                    {t("masterData.bankTransactions.tabs.incoming")}
                  </SelectItem>
                  <SelectItem value="OUTGOING">
                    {t("masterData.bankTransactions.tabs.outgoing")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>{t("importCenter.wizard.googleSheets.urlLabel")}</Label>
            <Input
              value={spreadsheetUrl}
              onChange={(e) => setSpreadsheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("importCenter.wizard.mapping.title")}</Label>
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border/60 p-2">
              {fields.map((field) => (
                <div key={field.key} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate text-caption">
                    {field.label}
                    {field.required && <span className="text-destructive"> *</span>}
                  </span>
                  {field.referenceType && (
                    <EnterpriseBadge variant="secondary" className="shrink-0">
                      {field.referenceType}
                    </EnterpriseBadge>
                  )}
                  <Input
                    className="h-8"
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                    placeholder={t("importCenter.wizard.mapping.selectColumn")}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <EnterpriseButton
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={handleCreate}
            disabled={saving || !label || !spreadsheetUrl}
          >
            {saving ? t("common.loading") : t("common.save")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PushReferenceDataDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useLocale();
  const [types, setTypes] = useState<ReferenceDataType[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    if (open)
      referenceDataService
        .listTypes()
        .then(setTypes)
        .catch(() => setTypes([]));
  }, [open]);

  const toggle = (type: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      await referenceDataService.pushToSheet({ spreadsheetUrl, types: [...selected] });
      toast.success(t("importCenter.sync.sources.referenceDataPushed"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to push reference data.");
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("importCenter.sync.sources.pushReferenceData")}</DialogTitle>
          <DialogDescription>
            {t("importCenter.sync.sources.pushReferenceDataDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t("importCenter.wizard.googleSheets.urlLabel")}</Label>
            <Input
              value={spreadsheetUrl}
              onChange={(e) => setSpreadsheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {types.map((type) => (
              <label key={type.type} className="flex items-center gap-2 text-caption">
                <Checkbox
                  checked={selected.has(type.type)}
                  onCheckedChange={() => toggle(type.type)}
                />
                {type.label}
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <EnterpriseButton
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pushing}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={handlePush}
            disabled={pushing || !spreadsheetUrl || selected.size === 0}
          >
            <RefreshCw className={pushing ? "animate-spin" : undefined} />
            {pushing ? t("common.loading") : t("common.save")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
