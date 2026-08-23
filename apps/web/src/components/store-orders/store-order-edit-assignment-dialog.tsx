"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { storeOrdersService } from "@/services/store-orders-service";
import { useUsersList } from "@/hooks/use-reference-data";
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
  const users = useUsersList();
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
        <Label>{t("storeOrders.fields.employee")}</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("common.select")} />
          </SelectTrigger>
          <SelectContent>
            {users
              .filter((user) => user.isActive)
              .map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.fullName}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </EnterpriseModal>
  );
}
