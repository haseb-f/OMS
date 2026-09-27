"use client";

import { useParams } from "next/navigation";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ReconciliationWorkspace } from "@/components/payments/reconciliation/reconciliation-workspace";

export default function PaymentReconciliationWorkspacePage() {
  const params = useParams<{ methodId: string }>();
  return (
    <PermissionGate permission="finance.payment-reconciliation.view">
      <ReconciliationWorkspace methodId={params.methodId} />
    </PermissionGate>
  );
}
