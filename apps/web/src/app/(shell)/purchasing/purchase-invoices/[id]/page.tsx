"use client";
import { useParams } from "next/navigation";
import { InvoiceEditorPage } from "../invoice-editor-page";
export default function PurchaseInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  return <InvoiceEditorPage id={params.id} />;
}
