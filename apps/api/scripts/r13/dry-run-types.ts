/** R13 migration dry-run output (shared by `r13-migration-dry-run.ts` and `r13-before-after.ts`). */

export interface ProductCountRow {
  itemType: string | null;
  supplyMethod: string;
  isInventoryItem: boolean;
  isSellable: boolean;
  isPurchasable: boolean;
  agentOwned: boolean;
  legacyType: string;
  deleted: boolean;
  count: number;
}

export interface ProductRef {
  id: string;
  sku: string;
  name: string;
  type: string;
  itemType: string | null;
  supplyMethod: string;
  isInventoryItem: boolean;
  isSellable: boolean;
  isPurchasable: boolean;
  status: string;
}

export interface Listing<T> {
  count: number;
  rows: T[];
}

export interface DryRunReport {
  meta: {
    database: string;
    host: string;
    generatedAt: string;
    lastMigration: string | null;
    r13Applied: boolean;
    /** COLUMN = stored `supply_method`; PROJECTED = what the R13 backfill would set (pre-migration). */
    supplyMethodSource: 'COLUMN' | 'PROJECTED';
  };
  review: {
    productCounts: ProductCountRow[];
    unclassifiedItemType: Listing<ProductRef>;
    legacyTypeInconsistencies: Listing<ProductRef & { derivedType: string }>;
    attributeRuleViolations: Listing<ProductRef & { code: string }>;
    assembledAndKits: Listing<
      ProductRef & {
        legacyComponents: number;
        recipes: Record<string, number>;
      }
    >;
    draftRecipesNeedingActivation: Listing<{
      productId: string;
      sku: string;
      name: string;
      supplyMethod: string;
      version: number | null;
      lines: number;
      migrated: boolean;
    }>;
    barcodeDuplicates: Listing<{ barcode: string; products: string[] }>;
    productsWithStockButNoCost: Listing<{
      productId: string;
      sku: string;
      name: string;
      onHand: number;
      movements: number;
      agentOwned: boolean;
    }>;
    investmentEligibilityBlocked: Listing<{
      productId: string;
      sku: string;
      name: string;
      reasons: string[];
      opportunities: string[];
    }>;
    agentOwnedWithCompanyGl: Listing<{
      kind: string;
      entryNumber: string;
      sourceType: string;
      movementNumber: string;
      sku: string;
    }>;
  };
  baseline: {
    products: { count: number; deleted: number; attributeFingerprint: string };
    movements: {
      count: number;
      byType: Record<string, number>;
      fingerprint: string;
    };
    /** `${productId}|${warehouseId}` → "onHand/reserved". */
    onHand: Record<string, string>;
    onHandUnits: number;
    companyStockValue: string;
    costs: {
      productsWithCost: number;
      currentCostFingerprint: string;
      snapshots: number;
      snapshotFingerprint: string;
      history: number;
      historyFingerprint: string;
      invoiceLineCostFingerprint: string;
    };
    gl: {
      entries: number;
      lines: number;
      totalDebit: string;
      totalCredit: string;
      linesFingerprint: string;
      inventoryAccounts: {
        id: string;
        code: string;
        name: string;
        balance: string;
      }[];
      cogsBalance: string;
    };
    salesDeliveryCogs: { movementValue: string; invoiceLineCogs: string };
    /** `dropped`: the legacy table no longer exists (R13 follow-up migration, owner approval O3). */
    legacyComponents: { count: number; fingerprint: string; dropped?: boolean };
    recipes: { count: number; byStatus: Record<string, number> };
  };
}
