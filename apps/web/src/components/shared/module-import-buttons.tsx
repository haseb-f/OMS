"use client";

import { useEffect, useState } from "react";
import { Download, Sheet, Upload } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ImportJobWizard } from "@/app/(shell)/data-management/import-center/import-job-wizard";
import { importTypesService, type ImportTypeDefinition } from "@/services/import-types-service";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { downloadBlob } from "@/lib/download";
import { ApiError } from "@/services/api-client";

export function ModuleImportButtons({
  importType,
  onImported,
}: {
  importType: string;
  onImported?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canImport = hasPermission("import-center.manage");

  const [typeDef, setTypeDef] = useState<ImportTypeDefinition | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSource, setWizardSource] = useState<"file" | "sheets">("file");

  useEffect(() => {
    if (!canImport) return;
    importTypesService
      .list()
      .then((types) => setTypeDef(types.find((type) => type.type === importType) ?? null))
      .catch(() => setTypeDef(null));
  }, [importType, canImport]);

  if (!typeDef || !canImport) return null;

  const handleDownloadTemplate = async () => {
    try {
      const blob = await importTypesService.downloadTemplate(typeDef.type);
      downloadBlob(blob, `${typeDef.type.toLowerCase().replace(/_/g, "-")}-import-template.xlsx`);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("importCenter.downloadTemplateFailed"),
      );
    }
  };

  const openWizard = (source: "file" | "sheets") => {
    setWizardSource(source);
    setWizardOpen(true);
  };

  return (
    <>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => void handleDownloadTemplate()}
      >
        <Download className="size-3.5" />
        {t("importCenter.actions.downloadTemplate")}
      </EnterpriseButton>
      <EnterpriseButton
        type="button"
        variant="default"
        size="sm"
        className="gap-1.5"
        disabled={!typeDef.isAvailable}
        onClick={() => openWizard("file")}
      >
        <Upload className="size-3.5" />
        {t("importCenter.actions.uploadDevice")}
      </EnterpriseButton>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={!typeDef.isAvailable}
        onClick={() => openWizard("sheets")}
      >
        <Sheet className="size-3.5" />
        {t("importCenter.actions.googleSheets")}
      </EnterpriseButton>
      <ImportJobWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        typeDef={typeDef}
        initialUploadMode={wizardSource}
        onDone={onImported ?? (() => {})}
      />
    </>
  );
}
