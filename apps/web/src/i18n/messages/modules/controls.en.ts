/** controls namespace (en) — shared copy / password / table-width / bulk-result controls (R6 workstream B). */
const controlsEn = {
  copy: {
    action: "Copy",
    actionNamed: "Copy {label}",
    copied: "Copied",
    copiedNamed: "Copied: {label}",
    failed: "Couldn't copy to the clipboard",
    failedReason:
      "The browser blocked clipboard access. Select the text and copy it with Ctrl+C instead.",
    reference: "reference",
    phone: "phone number",
    value: "value",
  },
  password: {
    label: "password",
  },
  table: {
    resetColumnWidths: "Reset column widths",
    columnWidthsReset: "Column widths reset.",
    resizeHandle: "Resize column {column}",
    resizeHint: "Drag, or use the ← → keys, to resize. Double-click to fit the content.",
  },
  bulk: {
    partial: "{succeeded} succeeded, {failed} failed",
    allFailed: "{failed} failed — nothing was changed",
    more: "…and {count} more",
  },
} as const;

export default controlsEn;
