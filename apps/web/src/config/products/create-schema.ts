import { z } from "zod";

/**
 * TASK-028 (Inventory Foundation pass) — the ONLY fields the initial Create
 * Product screen asks for: Name, Category, Unit, Product Behavior, Sales
 * Price. Everything else (dimensions, barcode, QR, image, attachments,
 * variants, supplier, purchase price, tax, warehouse, analytic account,
 * costing method, tracking, notes/tags/descriptions) is deferred to
 * post-save editing via the full product modal's tabs — never asked for
 * here, however useful it might be, because "extremely simple" was the
 * explicit instruction. Unit stays required (ADR-0012, still needed for
 * accounting/inventory/reporting).
 */
export const productCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    "PURCHASE_ONLY",
    "SALES_ONLY",
    "PURCHASE_AND_SALE",
    "MANUFACTURED",
    "SERVICE",
    "EXPENSE_ITEM",
  ]),
  categoryId: z.string().min(1),
  unitId: z.string().min(1),
  salesPrice: z.number().optional(),
});

export type ProductCreateFormValues = z.infer<typeof productCreateSchema>;

export const productCreateDefaultValues: ProductCreateFormValues = {
  name: "",
  type: "PURCHASE_AND_SALE",
  categoryId: "",
  unitId: "",
  salesPrice: undefined,
};
