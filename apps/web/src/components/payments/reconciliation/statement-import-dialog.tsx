"use client";

import { useRef, useState } from "react";
import { BookmarkCheck, FileSpreadsheet, RefreshCw, UploadCloud } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalFieldFullWidth, ModalSection } from "@/components/shared/modal-section";
import { EnterpriseButton } from "@/components/ui/button";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  paymentReconciliationService,
  type StatementMapping,
  type StatementMappingSource,
  type StatementPreview,
} from "@/services/payment-reconciliation-service";
import { MappingEditor } from "./mapping-editor";
import { StatementPreviewPanel } from "./statement-preview";
import { missingRequiredFields } from "./reconciliation-model";

/** File import wizard: choose file → map columns → preview with row validation → import. */
export function StatementImportDialog({
  methodId,
  open,
  onOpenChange,
  onImported,
}: {
  methodId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  /** Where the file's first mapping came from — the method's saved mapping or a header guess. */
  const [mappingOrigin, setMappingOrigin] = useState<StatementMappingSource | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setMapping(null);
    setPreview(null);
    setMappingOrigin(null);
  };

  const runPreview = async (nextFile: File, nextMapping: StatementMapping | null) => {
    setBusy(true);
    try {
      const result = await paymentReconciliationService.previewFile(
        methodId,
        nextFile,
        nextMapping,
      );
      setPreview(result);
      setMapping(result.mapping);
      if (!nextMapping) setMappingOrigin(result.mappingSource ?? null);
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const missing = mapping ? missingRequiredFields(mapping) : [];

  const commit = async () => {
    if (!file || !mapping) return;
    setBusy(true);
    try {
      const summary = await paymentReconciliationService.commitFile(methodId, file, mapping);
      toast.success(
        t("paymentReconciliation.import.committed", {
          created: String(summary.createdRows),
          duplicate: String(summary.duplicateRows),
          updated: String(summary.updatedRows),
          exception: String(summary.exceptionRows),
          error: String(summary.errorRows),
        }),
      );
      if (summary.errorRows > 0) {
        toast.warning(
          t("paymentReconciliation.import.committedErrors", { count: String(summary.errorRows) }),
        );
      }
      reset();
      onOpenChange(false);
      onImported();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      size="xl"
      icon={FileSpreadsheet}
      title={t("paymentReconciliation.import.title")}
      description={t("paymentReconciliation.import.description")}
      isDirty={!!file}
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="ghost" onClick={requestClose} disabled={busy}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={() => void commit()}
            disabled={
              busy ||
              !file ||
              !preview ||
              missing.length > 0 ||
              preview.mappingErrors.length > 0 ||
              (preview.summary?.totalRows ?? 0) === 0
            }
            isLoading={busy}
          >
            <UploadCloud />
            {t("paymentReconciliation.import.commit")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const next = event.target.files?.[0];
              event.target.value = "";
              if (!next) return;
              setFile(next);
              void runPreview(next, null);
            }}
          />
          <EnterpriseButton
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <UploadCloud />
            {file
              ? t("paymentReconciliation.import.changeFile")
              : t("paymentReconciliation.import.chooseFile")}
          </EnterpriseButton>
          <span className="min-w-0 truncate text-caption text-muted-foreground" dir="auto">
            {file?.name ?? t("paymentReconciliation.import.noFile")}
            {preview?.sheetName ? ` · ${preview.sheetName}` : ""}
          </span>
        </div>

        {file && mapping && preview ? (
          <>
            <ModalSection title={t("paymentReconciliation.import.mappingTitle")}>
              <ModalFieldFullWidth className="flex flex-col gap-3">
                {mappingOrigin === "SAVED" || mappingOrigin === "SUGGESTED" ? (
                  <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
                    {mappingOrigin === "SAVED" ? (
                      <BookmarkCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    ) : null}
                    {mappingOrigin === "SAVED"
                      ? t("paymentReconciliation.import.mappingSaved")
                      : t("paymentReconciliation.import.mappingSuggested")}
                  </p>
                ) : null}
                <MappingEditor
                  headers={preview.headers}
                  mapping={mapping}
                  onChange={setMapping}
                  disabled={busy}
                />
                {missing.length > 0 ? (
                  <p className="text-caption text-destructive">
                    {t("paymentReconciliation.import.mappingIncomplete", {
                      fields: missing
                        .map((field) => t(`paymentReconciliation.fields.${field}` as MessageKey))
                        .join("، "),
                    })}
                  </p>
                ) : null}
                <div>
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void runPreview(file, mapping)}
                    disabled={busy || missing.length > 0}
                  >
                    <RefreshCw />
                    {t("paymentReconciliation.import.refreshPreview")}
                  </EnterpriseButton>
                </div>
              </ModalFieldFullWidth>
            </ModalSection>
            <ModalSection title={t("paymentReconciliation.import.previewTitle")}>
              <ModalFieldFullWidth>
                <StatementPreviewPanel preview={preview} />
              </ModalFieldFullWidth>
            </ModalSection>
          </>
        ) : null}
      </div>
    </EnterpriseModal>
  );
}
