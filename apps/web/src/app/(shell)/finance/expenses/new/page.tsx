"use client";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ExpenseEditorPage } from "../expense-editor-page";

export default function NewExpensePage() {
  return (
    <PermissionGate permission="accounting.expense-payments.create">
      <ExpenseEditorPage id={null} />
    </PermissionGate>
  );
}
