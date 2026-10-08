"use client";

import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { Fragment, useEffect, useState } from "react";
import { Download, FileUp, History, Sheet, Upload } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportJobWizard } from "@/app/(shell)/data-management/import-center/import-job-wizard";
import { ImportHistoryDialog } from "@/components/import-center/import-history-dialog";
import type { ImportTypeDefinition } from "@/services/import-types-service";
import { COMPANY_IMPORT_API, fetchImportTemplate, type ImportApi } from "@/services/import-api";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { downloadBlob } from "@/lib/download";
import { cachedLookup } from "@/lib/lookup-cache";
import type { MessageKey } from "@/i18n/translate";

const TYPES_TTL_MS = 5 * 60_000;

/**
 * The ONE import entry point for a list page: a single "Import" menu with
 * Download template / Upload Excel-CSV / Google Sheets. A page that imports
 * several record types (e.g. Inventory Movements: opening stock and
 * adjustments) passes all of them and gets one menu grouped per type —
 * never one button row per type.
 *
 * R15 (D15-16) — shown for the types the user may import (the type's own
 * permission, e.g. `crm.leads.import`, or `import-center.manage`; the server
 * decides `canImport`), never behind an Import Center role. Sales types
 * (Leads / Store Orders) add "My imports" — the user's own import history.
 * The agent portal uses the same menu with its own endpoints (`api`).
 */
export function ModuleImportButtons({
  importType,
  onImported,
  api = COMPANY_IMPORT_API,
}: {
  importType: string | string[];
  onImported?: () => void;
  /** The agent portal passes its own endpoint family (R15). */
  api?: ImportApi;
}) {
  const { t, locale } = useLocale();
  const wanted = Array.isArray(importType) ? importType : [importType];
  const wantedKey = wanted.join(",");

  const [typeDefs, setTypeDefs] = useState<ImportTypeDefinition[]>([]);
  const [wizard, setWizard] = useState<{
    typeDef: ImportTypeDefinition;
    source: "file" | "sheets";
    jobId?: string;
  } | null>(null);
  const [history, setHistory] = useState<ImportTypeDefinition | null>(null);

  useEffect(() => {
    const types = wantedKey.split(",");
    cachedLookup(`import-types:${api.scope}`, () => api.types.list(), TYPES_TTL_MS)
      .then((all) =>
        setTypeDefs(
          types
            .map((type) => all.find((definition) => definition.type === type))
            .filter(
              (definition): definition is ImportTypeDefinition =>
                Boolean(definition) && definition?.canImport !== false,
            ),
        ),
      )
      .catch(() => setTypeDefs([]));
  }, [wantedKey, api]);

  if (typeDefs.length === 0) return null;

  const downloadTemplate = async (typeDef: ImportTypeDefinition) => {
    try {
      const { blob, fileName } = await fetchImportTemplate(
        api,
        typeDef,
        locale === "ar" ? "ar" : "en",
      );
      downloadBlob(blob, fileName);
    } catch (error) {
      reportApiError(error, "importCenter.downloadTemplateFailed");
    }
  };

  const grouped = typeDefs.length > 1;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EnterpriseButton type="button" variant="menu" size="sm" className="gap-1.5">
            <FileUp className="size-3.5" />
            <span data-slot="action-label">{t("docFlow.import.menu")}</span>
            <TriggerChevron kind="menu" size="sm" />
          </EnterpriseButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {typeDefs.map((typeDef, index) => (
            <Fragment key={typeDef.type}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              {grouped ? (
                <DropdownMenuLabel className="text-caption text-muted-foreground">
                  {t(typeDef.labelKey as MessageKey)}
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuItem
                className="min-h-9 gap-2"
                onSelect={() => void downloadTemplate(typeDef)}
              >
                <Download className="size-3.5" />
                {t("importCenter.actions.downloadTemplate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-9 gap-2"
                disabled={!typeDef.isAvailable}
                onSelect={() => setWizard({ typeDef, source: "file" })}
              >
                <Upload className="size-3.5" />
                {t("importCenter.actions.uploadDevice")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-9 gap-2"
                disabled={!typeDef.isAvailable}
                onSelect={() => setWizard({ typeDef, source: "sheets" })}
              >
                <Sheet className="size-3.5" />
                {t("importCenter.actions.googleSheets")}
              </DropdownMenuItem>
              {typeDef.salesFields?.length ? (
                <DropdownMenuItem className="min-h-9 gap-2" onSelect={() => setHistory(typeDef)}>
                  <History className="size-3.5" />
                  {t("salesImport.actions.myImports")}
                </DropdownMenuItem>
              ) : null}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {history ? (
        <ImportHistoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setHistory(null);
          }}
          jobs={api.jobs}
          typeDef={history}
          onOpenJob={(job) => {
            setHistory(null);
            setWizard({ typeDef: history, source: "file", jobId: job.id });
          }}
        />
      ) : null}
      {wizard ? (
        <ImportJobWizard
          open
          onOpenChange={(open) => {
            if (!open) setWizard(null);
          }}
          typeDef={wizard.typeDef}
          initialJobId={wizard.jobId}
          initialUploadMode={wizard.source}
          onDone={onImported ?? (() => {})}
          api={api}
        />
      ) : null}
    </>
  );
}
