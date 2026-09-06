import { isValidElement, type ReactNode } from "react";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import type { ColumnType } from "@/components/shared/data-table/column-engine";

/**
 * Applies shared RTL/LTR semantics to plain string/number table cells.
 * Custom React cell trees (badges, stacked cells, existing SemanticValue)
 * are left untouched — column configs that already own direction win.
 */
export function applySemanticCellContent(
  content: ReactNode,
  type: ColumnType | undefined,
): ReactNode {
  if (content == null || content === false) return content;
  if (isValidElement(content)) return content;
  if (typeof content !== "string" && typeof content !== "number") return content;

  const text = String(content);
  if (!text || text === "—") return content;

  switch (type) {
    case "date":
      return <SemanticValue kind="date">{text}</SemanticValue>;
    case "code":
      return <SemanticValue kind="id">{text}</SemanticValue>;
    case "phone":
      return <SemanticValue kind="phone">{text}</SemanticValue>;
    case "money":
      return <SemanticValue kind="money">{text}</SemanticValue>;
    case "number":
      return <SemanticValue kind="number">{text}</SemanticValue>;
    case "name":
    case "description":
    case "status":
    case "default":
      return <LocaleText>{text}</LocaleText>;
    default:
      return content;
  }
}
