"use client";

import { useEffect, useState } from "react";
import { Download, UploadCloud } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ImportJobWizard } from "@/app/(shell)/data-management/import-center/import-job-wizard";
import { importTypesService, type ImportTypeDefinition } from "@/services/import-types-service";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { downloadBlob } from "@/lib/download";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

/**
 * TASK-060B Part 5 — "User should import directly from module without
 * opening Import Center." Drop this into any module list page's toolbar
 * (alongside the existing "+ New" button) to get Import + Download Excel
 * Template without leaving the page — reuses the exact same
 * `ImportTypeRegistryService` type definition, `ImportJobWizard`, and
 * `import-center/types/:type/template` endpoint the Import Center itself
 * uses, never a second import pipeline.
 */
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

  useEffect(() => {
    importTypesService
      .list()
      .then((types) => setTypeDef(types.find((type) => type.type === importType) ?? null))
      .catch(() => setTypeDef(null));
  }, [importType]);

  if (!typeDef || !canImport) return null;

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
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={handleDownloadTemplate}
      >
        <Download className="size-3.5" />
        {t("importCenter.downloadTemplate")}
      </EnterpriseButton>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={!typeDef.isAvailable}
        onClick={() => setWizardOpen(true)}
      >
        <UploadCloud className="size-3.5" />
        {t("importCenter.wizard.title", { type: t(typeDef.labelKey as MessageKey) })}
      </EnterpriseButton>
      <ImportJobWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        typeDef={typeDef}
        onDone={onImported ?? (() => {})}
      />
    </>
  );
}
