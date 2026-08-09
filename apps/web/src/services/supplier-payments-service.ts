import { createFinancialTransactionService } from "./financial-transactions-service";

export * from "./financial-transactions-service";

/** Supplier Payment module (TASK-043) — thin instantiation of the shared generic factory. */
export const supplierPaymentsService = createFinancialTransactionService(
  "/financial-transactions/payments",
  "supplierId",
);
