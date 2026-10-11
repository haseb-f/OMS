"use client";

import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/locale-provider";

/**
 * R17 §2 — shown on every "Edit" of an ACTIVE agreement (commission or
 * shipping): the change is a new version from the save instant; orders
 * already registered keep the charges and commission assessed when they
 * were created. One notice for both agreement kinds.
 */
export function AgreementVersionNotice({
  agreementNumber,
  versionNumber,
}: {
  agreementNumber: string;
  versionNumber: number;
}) {
  const { t } = useLocale();
  return (
    <Alert tone="info" role="note">
      <Info aria-hidden />
      <AlertDescription className="flex flex-col gap-0.5">
        <p className="font-medium">
          {t("agents.agreements.version.editing", {
            number: agreementNumber,
            version: versionNumber,
          })}
        </p>
        <p>{t("agents.agreements.version.notice")}</p>
      </AlertDescription>
    </Alert>
  );
}
