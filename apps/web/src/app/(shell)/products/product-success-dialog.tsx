"use client";

import { CircleCheck, Package, PackagePlus, ListChecks, Boxes } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <CircleCheck className="size-6" />
            </span>
            <div className="flex flex-col gap-1">
              <DialogTitle>{t("products.successDialog.title")}</DialogTitle>
              <DialogDescription>
                {product?.displayName} — <code dir="ltr">{product?.sku}</code>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
