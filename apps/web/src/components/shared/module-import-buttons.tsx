"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Download, FileUp, Sheet, Upload } from "lucide-react";
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
import { importTypesService, type ImportTypeDefinition } from "@/services/import-types-service";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { downloadBlob } from "@/lib/download";
import { cachedLookup } from "@/lib/lookup-cache";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

const TYPES_TTL_MS = 5 * 60_000;

/**
 * The ONE import entry point for a list page: a single "Import" menu with
 * Download template / Upload Excel-CSV / Google Sheets. A page that imports
 * several record types (e.g. Inventory Movements: opening stock and
 * adjustments) passes all of them and gets one menu grouped per type —
 * never one button row per type.
 */
export function ModuleImportButtons({
  importType,
  onImported,
}: {
  importType: string | string[];
  onImported?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canImport = hasPermission("import-center.manage");
  const wanted = Array.isArray(importType) ? importType : [importType];
  const wantedKey = wanted.join(",");

  const [typeDefs, setTypeDefs] = useState<ImportTypeDefinition[]>([]);
  const [wizard, setWizard] = useState<{
    typeDef: ImportTypeDefinition;
    source: "file" | "sheets";
  } | null>(null);

  useEffect(() => {
    if (!canImport) return;
    const types = wantedKey.split(",");
    cachedLookup("import-types", () => importTypesService.list(), TYPES_TTL_MS)
      .then((all) =>
        setTypeDefs(
          types
            .map((type) => all.find((definition) => definition.type === type))
            .filter((definition): definition is ImportTypeDefinition => Boolean(definition)),
        ),
      )
      .catch(() => setTypeDefs([]));
  }, [wantedKey, canImport]);

  if (!canImport || typeDefs.length === 0) return null;

  const downloadTemplate = async (typeDef: ImportTypeDefinition) => {
    try {
      const blob = await importTypesService.downloadTemplate(typeDef.type);
      downloadBlob(blob, `${typeDef.type.toLowerCase().replace(/_/g, "-")}-import-template.xlsx`);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("importCenter.downloadTemplateFailed"),
      );
    }
  };

  const grouped = typeDefs.length > 1;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EnterpriseButton type="button" variant="outline" size="sm" className="gap-1.5">
            <FileUp className="size-3.5" />
            {t("docFlow.import.menu")}
            <ChevronDown className="size-3.5 opacity-60" />
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
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {wizard ? (
        <ImportJobWizard
          open
          onOpenChange={(open) => {
            if (!open) setWizard(null);
          }}
          typeDef={wizard.typeDef}
          initialUploadMode={wizard.source}
          onDone={onImported ?? (() => {})}
        />
      ) : null}
    </>
  );
}
