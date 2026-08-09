"use client";

import { ConfirmationDialog } from "./confirmation-dialog";
import { useLocale } from "@/providers/locale-provider";

/** Destructive-styled specialization of ConfirmationDialog — use this for every delete/archive confirmation. */
export function DeleteDialog({
  open,
  onOpenChange,
  itemName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName?: string;
  onConfirm: () => void;
}) {
  const { t } = useLocale();

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("common.delete")}
      description={itemName}
      onConfirm={onConfirm}
      confirmLabel={t("common.delete")}
      destructive
    />
  );
}
