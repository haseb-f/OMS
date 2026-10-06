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
    generate: "Generate a strong password",
    regenerate: "Generate another password",
    copied: "Password copied",
    newPassword: "New password",
    resetHint:
      "Enter or generate a password ({min}–{max} characters), or leave it empty to have the system generate one. The user must change it at the next sign-in.",
    tooShort: "Password must be {min}–{max} characters.",
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
    nothingToApply: "Nothing to apply — no selected record was eligible.",
  },
} as const;

export default controlsEn;
