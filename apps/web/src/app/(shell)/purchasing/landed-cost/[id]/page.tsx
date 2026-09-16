"use client";
import { useParams } from "next/navigation";
import { LandedCostEditorPage } from "../landed-cost-editor-page";
import { PermissionGate } from "@/components/shared/permission-gate";

export default function LandedCostDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <PermissionGate permission="landed-cost.view">
      <LandedCostEditorPage id={params.id} />
    </PermissionGate>
  );
}
