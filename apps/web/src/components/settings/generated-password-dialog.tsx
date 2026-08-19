"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";

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
  const [copiedPassword, setCopiedPassword] = useState<string | null>(null);
  const copied = copiedPassword !== null && copiedPassword === password;

  const copy = async () => {
    if (!password) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(password);
      setCopiedPassword(password);
      window.setTimeout(() => setCopiedPassword(null), 2000);
    } catch {
      toast.error(t("settings.users.passwordDialog.copyFailed"));
    }
  };

  return (
    <Dialog open={!!password} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("settings.users.passwordDialog.title")}</DialogTitle>
          <DialogDescription>{t("settings.users.passwordDialog.description")}</DialogDescription>
        </DialogHeader>
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
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void copy()}
            aria-label={
              copied
                ? t("settings.users.passwordDialog.copied")
                : t("settings.users.passwordDialog.copyTooltip")
            }
            title={
              copied
                ? t("settings.users.passwordDialog.copied")
                : t("settings.users.passwordDialog.copyTooltip")
            }
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied
              ? t("settings.users.passwordDialog.copied")
              : t("settings.users.passwordDialog.copy")}
          </EnterpriseButton>
        </div>
        <DialogFooter>
          <EnterpriseButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
