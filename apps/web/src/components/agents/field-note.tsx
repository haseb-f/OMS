import type { ReactNode } from "react";

/** The message under a form-card field: the validation error when present, otherwise a muted hint. */
export function FieldNote({ error, hint }: { error?: ReactNode; hint?: ReactNode }) {
  if (error) return <p className="text-caption text-destructive">{error}</p>;
  if (hint) return <p className="text-caption text-muted-foreground">{hint}</p>;
  return null;
}
