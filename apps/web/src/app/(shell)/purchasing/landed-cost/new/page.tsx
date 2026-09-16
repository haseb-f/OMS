"use client";
import { LandedCostEditorPage } from "../landed-cost-editor-page";
import { PermissionGate } from "@/components/shared/permission-gate";

export default function NewLandedCostPage() {
  return (
    <PermissionGate permission="landed-cost.create">
      <LandedCostEditorPage id={null} />
    </PermissionGate>
  );
}
