"use client";

import { useParams } from "next/navigation";
import { ReturnEditorPage } from "../return-editor-page";

export default function SalesReturnDetailPage() {
  const params = useParams<{ id: string }>();
  return <ReturnEditorPage id={params.id} />;
}
