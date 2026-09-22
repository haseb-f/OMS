"use client";

import { useParams } from "next/navigation";
import { PermissionGate } from "@/components/shared/permission-gate";
import { RefundEditorPage } from "../refund-editor-page";

export default function CustomerRefundDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <PermissionGate permission="sales.refunds.view">
      <RefundEditorPage id={params.id} />
    </PermissionGate>
  );
}
