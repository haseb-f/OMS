"use client";

import { useParams } from "next/navigation";
import { QuotationEditorPage } from "../quotation-editor-page";

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  return <QuotationEditorPage id={params.id} />;
}
