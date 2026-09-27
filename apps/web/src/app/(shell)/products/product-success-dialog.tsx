"use client";

import { CircleCheck, Package, PackagePlus, ListChecks, Boxes } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import type { ProductRow } from "@/services/products-service";

/**
 * TASK-028 Part 5 — "After successfully creating a product, display a
 * success dialog with four actions... Do NOT silently redirect." Shown
 * once, right after `ProductCreateDialog` succeeds; never reused as a
 * generic "saved" toast substitute — the toast still fires too (Global
 * Feedback System), this dialog is specifically the four-way fork.
 */
export function ProductSuccessDialog({
  open,
  onOpenChange,
  product,
  onAddAnother,
  onOpenProduct,
  onReturnToList,
  onCreateOpeningBalance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductRow | null;
  onAddAnother: () => void;
  onOpenProduct: () => void;
  onReturnToList: () => void;
  onCreateOpeningBalance: () => void;
}) {
  const { t } = useLocale();

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={CircleCheck}
      title={t("products.successDialog.title")}
      description={
        <>
          {product?.displayName} — <code dir="ltr">{product?.sku}</code>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <EnterpriseButton
          type="button"
          variant="outline"
          className="justify-start gap-2"
          onClick={onOpenProduct}
        >
          <Package className="size-4" />
          {t("products.successDialog.openProduct")}
        </EnterpriseButton>
        <EnterpriseButton
          type="button"
          variant="outline"
          className="justify-start gap-2"
          onClick={onCreateOpeningBalance}
        >
          <Boxes className="size-4" />
          {t("products.successDialog.createOpeningBalance")}
        </EnterpriseButton>
        <EnterpriseButton
          type="button"
          variant="outline"
          className="justify-start gap-2"
          onClick={onAddAnother}
        >
          <PackagePlus className="size-4" />
          {t("products.successDialog.addAnother")}
        </EnterpriseButton>
        <EnterpriseButton type="button" className="justify-start gap-2" onClick={onReturnToList}>
          <ListChecks className="size-4" />
          {t("products.successDialog.returnToList")}
        </EnterpriseButton>
      </div>
    </EnterpriseModal>
  );
}
