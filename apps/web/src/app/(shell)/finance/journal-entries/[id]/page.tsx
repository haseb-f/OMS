"use client";
import { useParams } from "next/navigation";
import { JournalEntryEditorPage } from "../journal-entry-editor-page";
export default function JournalEntryDetailPage() {
  const params = useParams<{ id: string }>();
  return <JournalEntryEditorPage id={params.id} />;
}
