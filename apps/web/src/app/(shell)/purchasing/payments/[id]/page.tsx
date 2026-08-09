"use client";
import { useParams } from "next/navigation";
import { PaymentEditorPage } from "../payment-editor-page";
export default function SupplierPaymentDetailPage() {
  const params = useParams<{ id: string }>();
  return <PaymentEditorPage id={params.id} />;
}
