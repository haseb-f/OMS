"use client";

import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CopyButton } from "@/components/shared/copy-button";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/providers/locale-provider";

/**
 * One-time presentation of a server-generated password. Never used as a
 * second notification system — this is the dedicated success surface for
 * create/reset when the API returns `temporaryPassword`.
 */
export function GeneratedPasswordDialog({
  password,
  onOpenChange,
}: {
  password: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <EnterpriseModal
      open={!!password}
      onOpenChange={onOpenChange}
      size="sm"
      title={t("settings.users.passwordDialog.title")}
      description={t("settings.users.passwordDialog.description")}
      footer={
        <EnterpriseButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </EnterpriseButton>
      }
    >
      <div className="flex items-center gap-2" dir="ltr">
        <Input
          readOnly
          dir="ltr"
          inputSize="md"
          value={password ?? ""}
          className="font-mono tracking-wide"
          onFocus={(event) => event.currentTarget.select()}
          aria-label={t("settings.users.fields.password")}
        />
        <CopyButton
          variant="button"
          size="sm"
          value={password}
          label={t("settings.users.fields.password")}
        />
      </div>
    </EnterpriseModal>
  );
}
