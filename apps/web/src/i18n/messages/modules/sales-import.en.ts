/** salesImport namespace (en) — R15 W2 lead / store-order imports. */
const salesImportEn = {
  nav: {
    agentImports: "Imports",
  },
  fields: {
    lineAmount: "Line Amount",
    paymentDate: "Payment Date",
    repeatCustomer: "Repeat Customer",
  },
  actions: {
    menu: "Import",
    myImports: "My imports",
    importLeads: "Import leads",
    importOrders: "Import orders",
  },
  agentPage: {
    title: "Imports",
    description:
      "Import leads and orders into your agent from Excel or a private Google Sheet — the same rules as entering them by hand.",
    noPermission: "You have no import permission.",
  },
  history: {
    title: "My imports",
    description: "Your imports — open one to see its results or continue it.",
    type: "Type",
    skipped: "Skipped",
    empty: "No imports yet.",
  },
  summary: {
    new: "New",
    created: "Created",
    skipped: "Skipped — already imported",
    needsReview: "Needs review",
    rejected: "Rejected",
    duplicate: "Duplicated in the file",
    total: "Rows",
  },
  outcome: {
    REJECTED: "Rejected",
    NEEDS_REVIEW: "Needs review",
    REVIEW_REJECTED: "Rejected after review",
    SKIPPED: "Skipped",
    CREATED_NOTICE: "Created — note",
  },
  preview: {
    warningsTitle: "Before you import",
    skippedTitle: "Already in OMS — these rows will be skipped",
    needsReviewTitle: "Will need your review",
    fileWarning: "File",
  },
  mapping: {
    autoMapped: "{count} columns were matched automatically — check them before continuing.",
  },
  sheets: {
    shareTitle: "Share the sheet with OMS",
    shareHint:
      "In Google Sheets choose Share and add this address as Viewer. The sheet stays private — it never needs to be public.",
    copy: "Copy address",
    copied: "Address copied.",
    connected: "Your connected sheets",
    disconnect: "Disconnect",
    disconnected: "Sheet disconnected.",
    unavailable: "Google Sheets is not configured on this server.",
  },
  review: {
    title: "Rows that need your review",
    description:
      "Confirm creates the order for the matched customer as a new (repeat) order; reject keeps the row out with your reason.",
    confirm: "Confirm",
    reject: "Reject",
    confirmed: "Row confirmed.",
    rejected: "Row rejected.",
    rejectTitle: "Reject this row?",
  },
} as const;

export default salesImportEn;
