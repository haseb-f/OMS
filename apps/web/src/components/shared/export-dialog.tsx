"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocale } from "@/providers/locale-provider";

export interface ExportColumn {
  key: string;
  /** Pre-resolved display text — the caller passes a translated label, not a MessageKey. */
  label: string;
}

/**
 * The one Export surface every Entity Table reuses — a column picker in
 * front of the actual export, instead of a bare one-click download. The
 * caller supplies `onExport`, which receives only the columns the user kept
 * checked; this component owns no export format logic itself (CSV today,
 * any future format tomorrow, without changing this component).
 */
export function ExportDialog({
  open,
  onOpenChange,
  columns,
  onExport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ExportColumn[];
  onExport: (selectedKeys: string[]) => void;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(columns.map((c) => c.key)));

  const allChecked = selected.size === columns.length;

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(columns.map((c) => c.key)) : new Set());
  };

  const toggleOne = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("table.exportDialogTitle")}</DialogTitle>
          <DialogDescription>{t("table.exportDialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 border-b border-border pb-2">
            <Checkbox checked={allChecked} onCheckedChange={(c) => toggleAll(c === true)} />
            <span className="text-body font-medium">{t("table.selectAllColumns")}</span>
          </label>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {columns.map((column) => (
              <label key={column.key} className="flex items-center gap-2">
                <Checkbox
                  checked={selected.has(column.key)}
                  onCheckedChange={(c) => toggleOne(column.key, c === true)}
                />
                <span className="text-body">{column.label}</span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <EnterpriseButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            disabled={selected.size === 0}
            onClick={() => {
              onExport(columns.map((c) => c.key).filter((key) => selected.has(key)));
              onOpenChange(false);
            }}
          >
            <Download />
            {t("table.exportConfirm")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
