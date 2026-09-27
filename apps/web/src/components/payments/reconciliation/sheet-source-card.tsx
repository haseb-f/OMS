"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Link2, RefreshCw, Sheet } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalFieldFullWidth, ModalSection } from "@/components/shared/modal-section";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDateTime } from "@/lib/date";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import {
  paymentReconciliationService,
  type SheetSource,
  type StatementMapping,
  type StatementPreview,
} from "@/services/payment-reconciliation-service";
import { MappingEditor } from "./mapping-editor";
import { StatementPreviewPanel } from "./statement-preview";
import { missingRequiredFields } from "./reconciliation-model";

/**
 * Google Sheet connection + repeatable "Sync now" for one payment method.
 * A bare panel (heading + body) — the Statement tab places it beside the
 * import history inside ONE card, so there is no card-in-card.
 */
export function SheetSourceCard({
  methodId,
  canImport,
  onSynced,
}: {
  methodId: string;
  canImport: boolean;
  onSynced: () => void;
}) {
  const { t } = useLocale();
  const [source, setSource] = useState<SheetSource | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSource(await paymentReconciliationService.getSheetSource(methodId));
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    }
  }, [methodId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const summary = await paymentReconciliationService.syncSheet(methodId);
      toast.success(
        t("paymentReconciliation.sheet.synced", {
          created: String(summary.createdRows),
          duplicate: String(summary.duplicateRows),
          updated: String(summary.updatedRows),
          exception: String(summary.exceptionRows),
          deleted: String(summary.deletedAtSourceRows ?? 0),
          error: String(summary.errorRows),
        }),
      );
      onSynced();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setSyncing(false);
      void load();
    }
  };

  const connection = source?.connection ?? null;
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="flex items-center gap-2 text-card-title">
            <Sheet className="size-4 text-muted-foreground" aria-hidden />
            {t("paymentReconciliation.sheet.title")}
          </h3>
          <p className="text-caption text-muted-foreground">
            {t("paymentReconciliation.sheet.description")}
          </p>
        </div>
        {canImport && source?.configured ? (
          <div className="flex flex-wrap gap-2">
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConnectOpen(true)}
            >
              <Link2 />
              {connection
                ? t("paymentReconciliation.sheet.reconnect")
                : t("paymentReconciliation.sheet.connectTitle")}
            </EnterpriseButton>
            {connection ? (
              <EnterpriseButton
                type="button"
                size="sm"
                onClick={() => void sync()}
                disabled={syncing || connection.isSyncing}
                isLoading={syncing}
              >
                <RefreshCw />
                {syncing || connection.isSyncing
                  ? t("paymentReconciliation.sheet.syncing")
                  : t("paymentReconciliation.sheet.syncNow")}
              </EnterpriseButton>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 text-caption">
        {source && !source.configured ? (
          <Alert tone="warning">
            <AlertDescription>{t("paymentReconciliation.sheet.notConfigured")}</AlertDescription>
          </Alert>
        ) : null}
        {source?.serviceAccountEmail ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">
              {t("paymentReconciliation.sheet.shareWith")}
            </span>
            <code dir="ltr" className="select-all break-all text-foreground">
              {source.serviceAccountEmail}
            </code>
          </div>
        ) : null}
        {connection ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">{t("paymentReconciliation.sheet.tab")}:</span>
              {isCanonicalSheetUrl(connection.url) ? (
                <a
                  href={connection.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-primary hover:underline"
                  dir="auto"
                >
                  {connection.sheetName ?? connection.spreadsheetId}
                </a>
              ) : (
                <span className="truncate" dir="auto">
                  {connection.sheetName ?? connection.spreadsheetId}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">
                {t("paymentReconciliation.sheet.lastSync")}:
              </span>
              {connection.lastSyncAt ? (
                <>
                  <span>{formatDateTime(connection.lastSyncAt)}</span>
                  <StatusBadge
                    label={t(
                      connection.lastSyncStatus === "FAILED"
                        ? "paymentReconciliation.sheet.statusFailed"
                        : "paymentReconciliation.sheet.statusSuccess",
                    )}
                    tone={connection.lastSyncStatus === "FAILED" ? "destructive" : "success"}
                  />
                </>
              ) : (
                <span>{t("paymentReconciliation.sheet.never")}</span>
              )}
            </div>
            {connection.lastSyncStatus === "FAILED" && connection.lastSyncError ? (
              <Alert tone="destructive">
                <AlertDescription>
                  {t("paymentReconciliation.sheet.lastSyncFailed", {
                    error: connection.lastSyncError,
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            {connection.lastSyncResult && connection.lastSyncStatus === "SUCCESS" ? (
              <p className="text-muted-foreground">
                {t("paymentReconciliation.sheet.synced", {
                  created: String(connection.lastSyncResult.createdRows),
                  duplicate: String(connection.lastSyncResult.duplicateRows),
                  updated: String(connection.lastSyncResult.updatedRows),
                  exception: String(connection.lastSyncResult.exceptionRows),
                  deleted: String(connection.lastSyncResult.deletedAtSourceRows ?? 0),
                  error: String(connection.lastSyncResult.errorRows),
                })}
              </p>
            ) : null}
          </>
        ) : source?.configured ? (
          <p className="text-muted-foreground">{t("paymentReconciliation.sheet.notConnected")}</p>
        ) : null}
      </div>
      {connectOpen ? (
        <SheetConnectDialog
          methodId={methodId}
          initialUrl={connection?.url ?? ""}
          serviceAccountEmail={source?.serviceAccountEmail ?? null}
          initialMapping={connection?.mapping ?? null}
          onClose={() => setConnectOpen(false)}
          onConnected={() => {
            setConnectOpen(false);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

/** Only a docs.google.com spreadsheet URL is ever rendered as a link (defense in depth; the API already canonicalises it). */
function isCanonicalSheetUrl(url: string | null | undefined): url is string {
  return (
    !!url &&
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit(#gid=\d+)?$/.test(url)
  );
}

function SheetConnectDialog({
  methodId,
  initialUrl,
  serviceAccountEmail,
  initialMapping,
  onClose,
  onConnected,
}: {
  methodId: string;
  initialUrl: string;
  serviceAccountEmail: string | null;
  initialMapping: StatementMapping | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useLocale();
  const urlId = useId();
  const [url, setUrl] = useState(initialUrl);
  const [mapping, setMapping] = useState<StatementMapping | null>(initialMapping);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (withMapping: StatementMapping | null) => {
    setBusy(true);
    try {
      const result = await paymentReconciliationService.previewSheet(methodId, {
        url,
        mapping: withMapping ?? undefined,
      });
      setPreview(result);
      setMapping(result.mapping);
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!mapping) return;
    setBusy(true);
    try {
      await paymentReconciliationService.connectSheet(methodId, { url, mapping });
      toast.success(t("paymentReconciliation.sheet.connected"));
      onConnected();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

  const missing = mapping ? missingRequiredFields(mapping) : [];
  return (
    <EnterpriseModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      icon={Sheet}
      title={t("paymentReconciliation.sheet.connectTitle")}
      description={t("paymentReconciliation.sheet.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="ghost" onClick={requestClose} disabled={busy}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={() => void save()}
            disabled={
              busy || !preview || !mapping || missing.length > 0 || preview.mappingErrors.length > 0
            }
            isLoading={busy}
          >
            <Link2 />
            {t("paymentReconciliation.sheet.connect")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <Alert tone="info">
          <AlertDescription>
            {serviceAccountEmail
              ? t("paymentReconciliation.sheet.shareRequired", { email: serviceAccountEmail })
              : t("paymentReconciliation.sheet.shareRequiredNoEmail")}
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={urlId}>{t("paymentReconciliation.sheet.url")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={urlId}
              dir="ltr"
              value={url}
              placeholder={t("paymentReconciliation.sheet.urlPlaceholder")}
              onChange={(event) => setUrl(event.target.value)}
            />
            <EnterpriseButton
              type="button"
              variant="outline"
              onClick={() => void read(preview ? mapping : initialMapping)}
              disabled={busy || !url.trim()}
            >
              <RefreshCw />
              {t("paymentReconciliation.sheet.loadHeaders")}
            </EnterpriseButton>
          </div>
        </div>
        {preview && mapping ? (
          <>
            <ModalSection title={t("paymentReconciliation.import.mappingTitle")}>
              <ModalFieldFullWidth>
                <MappingEditor
                  headers={preview.headers}
                  mapping={mapping}
                  onChange={setMapping}
                  disabled={busy}
                />
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
