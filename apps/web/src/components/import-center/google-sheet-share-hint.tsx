"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { CopyButton } from "@/components/shared/copy-button";
import { DismissibleAlert } from "@/components/shared/dismissible-alert";
import { useLocale } from "@/providers/locale-provider";
import type { ImportTypesApi } from "@/services/import-types-service";

/**
 * R15 (D15-17) — the "Connect a Google Sheet" step: the OMS service-account
 * address to share the private sheet with (Viewer). OMS never asks for a
 * public sheet; reading it then connects the sheet to this importer (another
 * user's sheet, or a continuously synchronised one, is refused server-side).
 */
export function GoogleSheetShareHint({ types }: { types: ImportTypesApi }) {
  const { t } = useLocale();
  const [email, setEmail] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    types
      .sheetConnections()
      .then((result) => {
        if (alive) setEmail(result.serviceAccountEmail);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [types]);

  if (failed) {
    return (
      <DismissibleAlert tone="warning" dismissible={false}>
        {t("salesImport.sheets.unavailable")}
      </DismissibleAlert>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-caption font-semibold text-foreground">
        <Lock className="size-3.5" aria-hidden />
        {t("salesImport.sheets.shareTitle")}
      </p>
      <div className="flex min-w-0 items-center gap-1">
        <span dir="ltr" className="min-w-0 truncate font-mono text-caption">
          {email ?? "…"}
        </span>
        <CopyButton
          value={email}
          label={t("salesImport.sheets.copy")}
          disabled={!email}
          successToast={t("salesImport.sheets.copied")}
        />
      </div>
      <p className="text-caption text-muted-foreground">{t("salesImport.sheets.shareHint")}</p>
    </div>
  );
}
