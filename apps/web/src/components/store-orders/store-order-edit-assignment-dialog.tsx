"use client";

import { useEffect, useId, useState } from "react";
import { UserRound } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { Label } from "@/components/ui/label";
import { UserPicker } from "@/components/business/user-picker";
import { storeOrdersService } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

export function StoreOrderEditAssignmentDialog({
  orderId,
  employeeId,
  open,
  onOpenChange,
  onSaved,
}: {
  orderId: string;
  employeeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [value, setValue] = useState(employeeId ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(employeeId ?? "");
    }
  }, [open, employeeId]);

  const handleSave = async () => {
    if (!value) return;
    setIsSaving(true);
    try {
      await storeOrdersService.update(orderId, { employeeId: value });
      toast.success(t("storeOrders.detail.edit.saved"));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={UserRound}
      title={t("storeOrders.detail.edit.assignmentTitle")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
          submitDisabled={!value}
        />
      )}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>{t("storeOrders.fields.employee")}</Label>
        <UserPicker
          id={fieldId}
          value={value}
          onValueChange={setValue}
          placeholder={t("common.select")}
        />
      </div>
    </EnterpriseModal>
  );
}
