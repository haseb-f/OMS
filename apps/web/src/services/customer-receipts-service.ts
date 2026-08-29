import { createFinancialTransactionService } from "./financial-transactions-service";

export * from "./financial-transactions-service";

/** Customer Receipt module (TASK-043) — thin instantiation of the shared generic factory. */
export const customerReceiptsService = createFinancialTransactionService(
  "/financial-transactions/receipts",
);
