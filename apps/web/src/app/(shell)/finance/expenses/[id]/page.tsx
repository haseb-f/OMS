"use client";
import { useParams } from "next/navigation";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ExpenseEditorPage } from "../expense-editor-page";

export default function ExpenseDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <PermissionGate permission="accounting.expense-payments.view">
      <ExpenseEditorPage id={params.id} />
    </PermissionGate>
  );
}
