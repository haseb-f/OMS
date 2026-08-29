import { z } from "zod";

/**
 * Product Creation Wizard — the ONLY fields that are ever required: Name,
 * Category, Unit of Measure. Every other field across every step (Product
 * Type, image, description, pricing/tax/supplier, inventory settings/
 * dimensions) stays optional so a draft can be created after Step 1 alone.
 * Product Type defaults server-side to PURCHASE_AND_SALE when omitted
 * (`ProductsService.create`) — never presented as a mandatory extra step.
 */
export const productCreateSchema = z.object({
  // Step 1 — الأساسيات (required)
  name: z.string().min(1),
  categoryId: z.string().min(1),
  unitId: z.string().min(1),
  // Step 1 — optional
  type: z
    .enum([
      "PURCHASE_ONLY",
      "SALES_ONLY",
      "PURCHASE_AND_SALE",
      "MANUFACTURED",
      "SERVICE",
      "EXPENSE_ITEM",
    ])
    .optional(),
  imageUrl: z.string().optional(),
  description: z.string().optional(),
  // Step 2 — التسعير والتجارة (all optional)
  salesPrice: z.number().optional(),
  purchasePrice: z.number().optional(),
  taxId: z.string().optional(),
  preferredPartnerId: z.string().optional(),
  // Step 3 — المخزون (all optional)
  isInventoryItem: z.boolean().optional(),
  reorderLevel: z.number().optional(),
  preferredWarehouseId: z.string().optional(),
  weight: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  length: z.number().optional(),
});

export type ProductCreateFormValues = z.infer<typeof productCreateSchema>;

export const productCreateDefaultValues: ProductCreateFormValues = {
  name: "",
  categoryId: "",
  unitId: "",
  type: "PURCHASE_AND_SALE",
  imageUrl: undefined,
  description: undefined,
  salesPrice: undefined,
  purchasePrice: undefined,
  taxId: undefined,
  preferredPartnerId: undefined,
  isInventoryItem: undefined,
  reorderLevel: undefined,
  preferredWarehouseId: undefined,
  weight: undefined,
  width: undefined,
  height: undefined,
  length: undefined,
};

export const PRODUCT_WIZARD_STEPS = ["basics", "pricing", "inventory", "review"] as const;
export type ProductWizardStep = (typeof PRODUCT_WIZARD_STEPS)[number];
