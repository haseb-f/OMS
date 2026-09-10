import { createMasterDataService } from "./master-data-service";

export type PayrollComponentType = "EARNING" | "DEDUCTION";
export type PayrollComponentCalculationType = "FIXED" | "PERCENTAGE" | "VARIABLE";

export interface PayrollComponentRow {
  id: string;
  nameAr: string;
  nameEn: string | null;
  type: PayrollComponentType;
  calculationType: PayrollComponentCalculationType;
  defaultValue: string | null;
  accountingMappingAccountId: string | null;
  sortOrder: number;
  isActive: boolean;
  deletedAt: string | null;
}

export const payrollComponentsService =
  createMasterDataService<PayrollComponentRow>("/payroll-components");
