"use client";
import { useParams } from "next/navigation";
import { ReceiptEditorPage } from "../receipt-editor-page";
export default function CustomerReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  return <ReceiptEditorPage id={params.id} />;
}
