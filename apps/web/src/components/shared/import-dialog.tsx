"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/providers/locale-provider";

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

/**
 * The one Import surface every Entity Table can reuse — parses a CSV
 * client-side and shows a preview before handing the parsed rows to the
 * caller's `onImport`. This component owns no persistence itself: no
 * Master Data entity has a real bulk-import endpoint yet, so wiring this in
 * is opt-in per module rather than forced onto every list, and the preview
 * step keeps it honest about what will actually happen instead of a button
 * that silently does nothing.
 */
export function ImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: Record<string, string>[]) => Promise<void> | void;
}) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    setRows(parseCsv(text));
  };

  const reset = () => {
    setFileName(null);
    setRows([]);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("table.importDialogTitle")}</DialogTitle>
          <DialogDescription>{t("table.importDialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <EnterpriseButton
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload />
            {t("table.importChooseFile")}
          </EnterpriseButton>

          {fileName ? (
            <div className="flex flex-col gap-2">
              <p className="text-caption text-muted-foreground">
                {fileName} — {t("table.importPreviewRows", { count: rows.length })}
              </p>
              {rows.length > 0 && (
                <div className="max-h-48 overflow-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {Object.keys(rows[0]).map((header) => (
                          <TableHead key={header}>{header}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 5).map((row, index) => (
                        <TableRow key={index}>
                          {Object.values(row).map((value, cellIndex) => (
                            <TableCell key={cellIndex}>{value}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">{t("table.importNoFile")}</p>
          )}
        </div>

        <DialogFooter>
          <EnterpriseButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            disabled={rows.length === 0 || isImporting}
            onClick={async () => {
              setIsImporting(true);
              try {
                await onImport(rows);
                onOpenChange(false);
                reset();
              } finally {
                setIsImporting(false);
              }
            }}
          >
            {t("table.importConfirm")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
