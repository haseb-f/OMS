"use client";

import { PermissionGate } from "@/components/shared/permission-gate";
import { ReconciliationMethods } from "@/components/payments/reconciliation/reconciliation-methods";

export default function PaymentReconciliationPage() {
  return (
    <PermissionGate permission="finance.payment-reconciliation.view">
      <ReconciliationMethods />
    </PermissionGate>
  );
}
