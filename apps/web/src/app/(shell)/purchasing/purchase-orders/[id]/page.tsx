"use client";
import { useParams } from "next/navigation";
import { OrderEditorPage } from "../order-editor-page";
export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  return <OrderEditorPage id={params.id} />;
}
