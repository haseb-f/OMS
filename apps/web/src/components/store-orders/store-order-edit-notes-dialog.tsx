"use client";

import { useEffect, useState } from "react";
import { StickyNote } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { storeOrdersService } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

export function StoreOrderEditNotesDialog({
  orderId,
  notes,
  open,
  onOpenChange,
  onSaved,
}: {
  orderId: string;
  notes: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(notes ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(notes ?? "");
    }
  }, [open, notes]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await storeOrdersService.update(orderId, { notes: value.trim() || undefined });
      toast.success(t("storeOrders.detail.edit.saved"));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={StickyNote}
      title={t("storeOrders.detail.edit.notesTitle")}
      isDirty={value !== (notes ?? "")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
        />
      )}
    >
      <div className="flex flex-col gap-1.5">
        <Label>{t("storeOrders.createDialog.fields.notes")}</Label>
        <Textarea rows={5} value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
    </EnterpriseModal>
  );
}
