"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { downloadBlob } from "@/lib/download";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";
import {
  importJobsService,
  type ImportJobRow,
  type ImportJobStatus,
  type ImportPreviewResult,
  type ImportValidationResult,
} from "@/services/import-jobs-service";
import {
  importMappingTemplatesService,
  type ImportMappingTemplateRow,
} from "@/services/import-mapping-templates-service";
import { importTypesService, type ImportTypeDefinition } from "@/services/import-types-service";
import { IMPORT_JOB_STATUS_LABEL_KEY, IMPORT_JOB_STATUS_TONE } from "@/config/import-center/status";
import type { MessageKey } from "@/i18n/translate";

type Step = "upload" | "mapping" | "preview" | "results";

const CANCELLABLE_STATUSES: ImportJobStatus[] = ["DRAFT", "UPLOADING", "MAPPING", "VALIDATING"];

function resolveStep(job: ImportJobRow): Step {
  switch (job.status) {
    case "DRAFT":
    case "UPLOADING":
      return "upload";
    case "MAPPING":
      return "mapping";
    case "VALIDATING":
    case "IMPORTING":
      return job.columnMapping ? "preview" : "mapping";
    default:
      return "results";
  }
}

/**
 * Import Job Wizard (TASK-056 Part 3/4) — drives one `ImportJob` through
 * Upload -> Map Columns -> Preview -> Run -> Results. Never re-implements
 * the lifecycle itself; every step is a thin UI over `ImportJobsService`
 * (create/upload/preview/setMapping/run/cancel), which is the only place
 * rows are actually written (always via the target module's own service).
 */
export function ImportJobWizard({
  open,
  onOpenChange,
  typeDef,
  initialJobId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  typeDef: ImportTypeDefinition;
  initialJobId?: string;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [job, setJob] = useState<ImportJobRow | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [isLoading, setIsLoading] = useState(false);

  const [uploadMode, setUploadMode] = useState<"file" | "sheets">("file");
  const [file, setFile] = useState<File | null>(null);
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<ImportMappingTemplateRow[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [validation, setValidation] = useState<ImportValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFile(null);
    setSheetsUrl("");
    setUploadMode("file");
    setPreview(null);
    setMapping({});
    setTemplateName("");
    setValidation(null);
    setIsLoading(true);
    (async () => {
      try {
        if (initialJobId) {
          const existing = await importJobsService.get(initialJobId);
          setJob(existing);
          const resumedStep = resolveStep(existing);
          setStep(resumedStep);
          if (existing.sourceConnector === "google-sheets" && existing.sourceUrl) {
            setUploadMode("sheets");
            setSheetsUrl(existing.sourceUrl);
          }
          if (existing.columnMapping) setMapping(existing.columnMapping);
          if (resumedStep === "mapping" || resumedStep === "preview") {
            const previewData = await importJobsService.preview(existing.id, 10);
            setPreview(previewData);
          }
          if (resumedStep === "preview") {
            importJobsService
              .validate(existing.id)
              .then(setValidation)
              .catch(() => setValidation(null));
          }
        } else {
          const created = await importJobsService.create(typeDef.type);
          setJob(created);
          setStep("upload");
        }
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Failed to start import.");
        onOpenChange(false);
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialJobId, typeDef.type]);

  useEffect(() => {
    if (!open || step !== "mapping") return;
    importMappingTemplatesService
      .list(typeDef.type)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [open, step, typeDef.type]);

  const requiredFields = useMemo(
    () => typeDef.fields.filter((field) => field.required),
    [typeDef.fields],
  );
  const optionalFields = useMemo(
    () => typeDef.fields.filter((field) => !field.required),
    [typeDef.fields],
  );
  const missingRequired = requiredFields.filter((field) => !mapping[field.key]);
  const canCancelJob = job !== null && CANCELLABLE_STATUSES.includes(job.status);

  const handleUpload = async () => {
    if (!job || !file) return;
    setIsLoading(true);
    try {
      const updated = await importJobsService.upload(job.id, file);
      setJob(updated);
      const previewData = await importJobsService.preview(updated.id, 10);
      setPreview(previewData);
      setStep("mapping");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Upload failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadFromSheets = async () => {
    if (!job || !sheetsUrl.trim()) return;
    setIsLoading(true);
    try {
      const updated = await importJobsService.uploadFromGoogleSheets(job.id, sheetsUrl.trim());
      setJob(updated);
      const previewData = await importJobsService.preview(updated.id, 10);
      setPreview(previewData);
      setStep("mapping");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not read that Google Sheet.");
    } finally {
      setIsLoading(false);
    }
  };

  /** "Manual Refresh" — re-fetches the same Google Sheet without disturbing the saved mapping/step. */
  const handleRefresh = async () => {
    if (!job) return;
    setIsRefreshing(true);
    try {
      const updated = await importJobsService.refresh(job.id);
      setJob(updated);
      const previewData = await importJobsService.preview(updated.id, 10);
      setPreview(previewData);
      toast.success(t("importCenter.wizard.googleSheets.refreshed"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to refresh.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleContinueToPreview = async () => {
    if (!job || missingRequired.length > 0) return;
    setIsLoading(true);
    try {
      const updated = await importJobsService.setMapping(job.id, mapping);
      setJob(updated);
      setStep("preview");
      setIsValidating(true);
      importJobsService
        .validate(updated.id)
        .then(setValidation)
        .catch(() => setValidation(null))
        .finally(() => setIsValidating(false));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to save mapping.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      await importMappingTemplatesService.save({
        importType: typeDef.type,
        name: templateName.trim(),
        columnMapping: mapping,
      });
      toast.success(t("importCenter.wizard.mapping.templateSaved"));
      setTemplateName("");
      importMappingTemplatesService
        .list(typeDef.type)
        .then(setTemplates)
        .catch(() => {});
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to save template.");
    }
  };

  const handleRun = async () => {
    if (!job) return;
    setIsLoading(true);
    try {
      const result = await importJobsService.run(job.id);
      setJob(result);
      setStep("results");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Import failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelJob = async () => {
    if (!job) return;
    try {
      await importJobsService.cancel(job.id);
      setCancelConfirmOpen(false);
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel.");
    }
  };

  const handleDownloadErrors = async () => {
    if (!job) return;
    try {
      const blob = await importJobsService.exportErrorsCsv(job.id);
      downloadBlob(blob, `import-errors-${job.id}.csv`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to download report.");
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await importTypesService.downloadTemplate(typeDef.type);
      downloadBlob(blob, `${typeDef.type.toLowerCase().replace(/_/g, "-")}-import-template.xlsx`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to download template.");
    }
  };

  return (
    <>
      <EnterpriseModal
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        title={t("importCenter.wizard.title", { type: t(typeDef.labelKey as MessageKey) })}
        description={t(typeDef.descriptionKey as MessageKey)}
        footer={(requestClose) => (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {canCancelJob && (
                <EnterpriseButton
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setCancelConfirmOpen(true)}
                  disabled={isLoading}
                >
                  {t("importCenter.wizard.cancel")}
                </EnterpriseButton>
              )}
            </div>
            <div className="flex items-center gap-2">
              <EnterpriseButton type="button" variant="ghost" onClick={requestClose}>
                {t("common.close")}
              </EnterpriseButton>
              {step === "upload" && (
                <EnterpriseButton
                  type="button"
                  onClick={uploadMode === "file" ? handleUpload : handleUploadFromSheets}
                  disabled={(uploadMode === "file" ? !file : !sheetsUrl.trim()) || isLoading}
                >
                  {isLoading
                    ? t("importCenter.wizard.upload.uploading")
                    : t("importCenter.wizard.upload.uploadButton")}
                </EnterpriseButton>
              )}
              {step === "mapping" && (
                <>
                  {job?.sourceConnector === "google-sheets" && (
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      onClick={handleRefresh}
                      disabled={isRefreshing || isLoading || !!job?.isSyncing}
                      title={t("importCenter.wizard.googleSheets.refreshTooltip")}
                    >
                      <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
                      {isRefreshing
                        ? t("importCenter.wizard.googleSheets.refreshing")
                        : t("importCenter.wizard.googleSheets.refresh")}
                    </EnterpriseButton>
                  )}
                  <EnterpriseButton
                    type="button"
                    onClick={handleContinueToPreview}
                    disabled={missingRequired.length > 0 || isLoading}
                  >
                    {t("importCenter.wizard.mapping.continue")}
                  </EnterpriseButton>
                </>
              )}
              {step === "preview" && (
                <EnterpriseButton type="button" onClick={handleRun} disabled={isLoading}>
                  {isLoading
                    ? t("importCenter.wizard.preview.running")
                    : t("importCenter.wizard.preview.runImport")}
                </EnterpriseButton>
              )}
              {step === "results" && (
                <EnterpriseButton
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onDone();
                  }}
                >
                  {t("importCenter.wizard.results.done")}
                </EnterpriseButton>
              )}
            </div>
          </div>
        )}
      >
        <div className="mb-5 flex items-center gap-2 text-caption text-muted-foreground">
          {(["upload", "mapping", "preview", "results"] as Step[]).map((s, index) => (
            <div key={s} className="flex items-center gap-2">
              {index > 0 && <span className="text-border">/</span>}
              <span className={s === step ? "font-semibold text-foreground" : ""}>
                {t(`importCenter.wizard.steps.${s}`)}
              </span>
            </div>
          ))}
        </div>

        {step === "upload" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-card-title font-semibold">
                  {t("importCenter.wizard.upload.title")}
                </h2>
                <p className="text-body text-muted-foreground">
                  {t("importCenter.wizard.upload.description")}
                </p>
              </div>
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
              >
                <Download />
                {t("importCenter.downloadTemplate")}
              </EnterpriseButton>
            </div>
            <div className="flex gap-2">
              <EnterpriseButton
                type="button"
                size="sm"
                variant={uploadMode === "file" ? "default" : "outline"}
                onClick={() => setUploadMode("file")}
              >
                {t("importCenter.wizard.upload.sourceFile")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                size="sm"
                variant={uploadMode === "sheets" ? "default" : "outline"}
                onClick={() => setUploadMode("sheets")}
              >
                {t("importCenter.wizard.upload.sourceGoogleSheets")}
              </EnterpriseButton>
            </div>

            {uploadMode === "file" ? (
              <div className="flex flex-col gap-2">
                <Label>{t("importCenter.wizard.upload.chooseFile")}</Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                {file && (
                  <p className="text-caption text-muted-foreground">
                    {t("importCenter.wizard.upload.selectedFile")}:{" "}
                    <span dir="ltr">{file.name}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label>{t("importCenter.wizard.googleSheets.urlLabel")}</Label>
                <Input
                  dir="ltr"
                  value={sheetsUrl}
                  onChange={(event) => setSheetsUrl(event.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                />
                <p className="text-xs text-muted-foreground">
                  {t("importCenter.wizard.googleSheets.urlHint")}
                </p>
              </div>
            )}
          </div>
        )}

        {step === "mapping" && preview && (
          <div className="flex flex-col gap-6">
            <h2 className="text-card-title font-semibold">
              {t("importCenter.wizard.mapping.title")}
            </h2>
            <p className="text-body text-muted-foreground">
              {t("importCenter.wizard.mapping.description")}
            </p>

            {templates.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label>{t("importCenter.wizard.mapping.loadTemplate")}</Label>
                <Select
                  onValueChange={(value) => {
                    const template = templates.find((tpl) => tpl.id === value);
                    if (template) setMapping(template.columnMapping);
                  }}
                >
                  <SelectTrigger className="w-full sm:w-80">
                    <SelectValue placeholder={t("importCenter.wizard.mapping.loadTemplate")} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <h3 className="text-caption font-semibold text-foreground">
                {t("importCenter.wizard.mapping.requiredFields")}
              </h3>
              {requiredFields.map((field) => (
                <div key={field.key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2">
                  <Label>
                    {t(field.labelKey as MessageKey)} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={mapping[field.key] || undefined}
                    onValueChange={(value) =>
                      setMapping((prev) => ({ ...prev, [field.key]: value }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("importCenter.wizard.mapping.selectColumn")} />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {missingRequired.length > 0 && (
                <p className="text-xs text-destructive">
                  {t("importCenter.wizard.mapping.missingRequired")}
                </p>
              )}
            </div>

            {optionalFields.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-caption font-semibold text-foreground">
                  {t("importCenter.wizard.mapping.optionalFields")}
                </h3>
                {optionalFields.map((field) => (
                  <div
                    key={field.key}
                    className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2"
                  >
                    <Label>{t(field.labelKey as MessageKey)}</Label>
                    <Select
                      value={mapping[field.key] || "__none__"}
                      onValueChange={(value) =>
                        setMapping((prev) => ({
                          ...prev,
                          [field.key]: value === "__none__" ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("importCenter.wizard.mapping.noColumn")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {t("importCenter.wizard.mapping.noColumn")}
                        </SelectItem>
                        {preview.headers.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
              <div className="flex flex-1 flex-col gap-2">
                <Label>{t("importCenter.wizard.mapping.templateName")}</Label>
                <Input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder={t("importCenter.wizard.mapping.templateNamePlaceholder")}
                />
              </div>
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveTemplate}
                disabled={!templateName.trim()}
              >
                {t("importCenter.wizard.mapping.saveTemplate")}
              </EnterpriseButton>
            </div>
          </div>
        )}

        {step === "preview" && preview && job && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-card-title font-semibold">
                  {t("importCenter.wizard.preview.title")}
                </h2>
                <p className="text-body text-muted-foreground">
                  {t("importCenter.wizard.preview.description")}
                </p>
              </div>
              {job.sourceConnector === "google-sheets" && (
                <div className="flex flex-col items-end gap-1">
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={isRefreshing || !!job.isSyncing}
                    title={t("importCenter.wizard.googleSheets.refreshTooltip")}
                  >
                    <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
                    {isRefreshing
                      ? t("importCenter.wizard.googleSheets.refreshing")
                      : t("importCenter.wizard.googleSheets.refresh")}
                  </EnterpriseButton>
                  {job.lastSyncedAt && (
                    <p className="text-xs text-muted-foreground">
                      {t("importCenter.wizard.googleSheets.lastSynced", {
                        datetime: formatDateTime(job.lastSyncedAt),
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
            <p className="text-caption text-muted-foreground">
              {t("importCenter.wizard.preview.totalRowsHint", { count: job.totalRows })}
            </p>

            {isValidating ? (
              <p className="text-caption text-muted-foreground">
                {t("importCenter.wizard.validation.running")}
              </p>
            ) : validation ? (
              <div
                className={
                  validation.errorCount === 0
                    ? "flex flex-col gap-2 rounded-md border border-success/30 bg-success/5 p-4"
                    : "flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4"
                }
              >
                <p
                  className={
                    validation.errorCount === 0
                      ? "text-caption font-medium text-success"
                      : "text-caption font-medium text-destructive"
                  }
                >
                  {validation.errorCount === 0
                    ? t("importCenter.wizard.validation.passed")
                    : t("importCenter.wizard.validation.failed", { count: validation.errorCount })}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-border bg-card p-2 text-center">
                    <p className="text-card-title font-semibold">{validation.summary.totalRows}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("importCenter.wizard.preview.summaryTotal")}
                    </p>
                  </div>
                  <div className="rounded-md border border-success/30 bg-success/5 p-2 text-center">
                    <p className="text-card-title font-semibold text-success">
                      {validation.summary.newCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("importCenter.wizard.preview.summaryNew")}
                    </p>
                  </div>
                  <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-center">
                    <p className="text-card-title font-semibold text-warning">
                      {validation.summary.duplicateCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("importCenter.wizard.preview.summaryDuplicate")}
                    </p>
                  </div>
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-center">
                    <p className="text-card-title font-semibold text-destructive">
                      {validation.summary.invalidCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("importCenter.wizard.preview.summaryInvalid")}
                    </p>
                  </div>
                </div>
                {validation.duplicateGroups.length > 0 && (
                  <p className="text-xs text-destructive">
                    {t("importCenter.wizard.validation.duplicatesFound", {
                      count: validation.duplicateGroups.length,
                    })}
                  </p>
                )}
                {validation.errorCount > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("importCenter.wizard.preview.rowNumber")}</TableHead>
                          <TableHead>{t("importCenter.wizard.results.column")}</TableHead>
                          <TableHead>{t("importCenter.wizard.results.error")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validation.errors.map((error, index) => (
                          <TableRow key={index}>
                            <TableCell>{error.rowNumber}</TableCell>
                            <TableCell dir="ltr">{error.columnName ?? "—"}</TableCell>
                            <TableCell>{error.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("importCenter.wizard.preview.rowNumber")}</TableHead>
                    {typeDef.fields.map((field) => (
                      <TableHead key={field.key}>{t(field.labelKey as MessageKey)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell>{index + 2}</TableCell>
                      {typeDef.fields.map((field) => {
                        const column = mapping[field.key];
                        return (
                          <TableCell key={field.key}>
                            {column ? (row[column] ?? "") : "—"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {step === "results" && job && (
          <div className="flex flex-col gap-5">
            <h2 className="text-card-title font-semibold">
              {t("importCenter.wizard.results.title")}
            </h2>
            <div className="flex items-center gap-3">
              <StatusBadge
                label={t(IMPORT_JOB_STATUS_LABEL_KEY[job.status])}
                tone={IMPORT_JOB_STATUS_TONE[job.status]}
              />
              <p className="text-body">
                {job.status === "COMPLETED"
                  ? t("importCenter.wizard.results.completed")
                  : t("importCenter.wizard.results.failed")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-md border border-border p-3">
                <p className="text-caption text-muted-foreground">
                  {t("importCenter.wizard.results.totalRows")}
                </p>
                <p className="text-card-title font-semibold">{job.totalRows}</p>
              </div>
              <div className="rounded-md border border-success/30 bg-success/5 p-3">
                <p className="text-caption text-muted-foreground">
                  {t("importCenter.wizard.results.successCount")}
                </p>
                <p className="text-card-title font-semibold text-success">{job.successCount}</p>
              </div>
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-caption text-muted-foreground">
                  {t("importCenter.wizard.results.errorCount")}
                </p>
                <p className="text-card-title font-semibold text-destructive">{job.errorCount}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-caption text-muted-foreground">
                  {t("importCenter.wizard.results.duration")}
                </p>
                <p className="text-card-title font-semibold">
                  {job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}s` : "—"}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-caption font-semibold text-foreground">
                  {t("importCenter.wizard.results.errorsTitle")}
                </h3>
                {job.errors.length > 0 && (
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadErrors}
                  >
                    <Download />
                    {t("importCenter.wizard.results.downloadErrorReport")}
                  </EnterpriseButton>
                )}
              </div>
              {job.errors.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t("importCenter.wizard.results.noErrors")}
                </p>
              ) : (
                <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("importCenter.wizard.preview.rowNumber")}</TableHead>
                        <TableHead>{t("importCenter.wizard.results.column")}</TableHead>
                        <TableHead>{t("importCenter.wizard.results.error")}</TableHead>
                        <TableHead>{t("importCenter.wizard.results.suggestedFix")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {job.errors.map((error) => (
                        <TableRow key={error.id}>
                          <TableCell>{error.rowNumber}</TableCell>
                          <TableCell dir="ltr">{error.columnName ?? "—"}</TableCell>
                          <TableCell>{error.errorMessage}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {error.suggestedFix ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </EnterpriseModal>

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("importCenter.wizard.cancelConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("importCenter.wizard.cancelConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.keepEditing")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelJob}>
              {t("importCenter.wizard.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
