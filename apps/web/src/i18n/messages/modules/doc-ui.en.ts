/** docUi namespace (en) — document editors, totals, dashboard and store-order status (SC-DOCS). */
const docUiEn = {
  totals: {
    title: "Totals",
    totalDebit: "Total debit",
    totalCredit: "Total credit",
    difference: "Difference",
    balanced: "Balanced",
    unbalanced: "Unbalanced",
    amount: "Amount",
    allocated: "Allocated",
    unallocated: "Unallocated",
    overAllocated: "Over-allocated",
  },
  validation: {
    fixFields: "Fix the highlighted fields — nothing you entered was lost.",
  },
  lines: {
    lineNumber: "Line {number}",
    showDetails: "Show cost center and project",
    hideDetails: "Hide cost center and project",
  },
  statusStrip: {
    label: "Order status",
    declared: "Declared by Sales",
    verified: "Finance verification",
    fulfillment: "Fulfillment",
    shipping: "Shipping",
    duplicate: "Duplicate",
    invoicePayment: "Payment",
    paymentGroup: "Payment",
    fulfillmentGroup: "Fulfillment",
    paymentType: "Type",
  },
  dashboard: {
    period: "Period",
    salesTitle: "Sales performance",
    pendingTitle: "Pending work",
    paymentReview: "Payments awaiting review",
    paymentReviewHint: "Declared, not verified yet",
    bankUnmatched: "Unmatched bank transactions",
    bankReview: "Bank transactions to review",
    loadFailed: "Could not load these figures.",
    emptyTitle: "Nothing is waiting for you",
    emptyDescription: "No dashboard figures apply to your role. Your shortcuts are below.",
    shortcuts: "Your shortcuts",
    noShortcuts: "Pin a page from the sidebar to keep it here.",
    rank: "#{rank} of {of}",
    ordersCount: "{count} orders",
  },
} as const;

export default docUiEn;
