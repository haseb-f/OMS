/** home namespace (en) — the permission-aware Home launcher (design-system §12.17). */
const homeEn = {
  title: "Home",
  subtitle: "Open any module you have access to.",
  modulesTitle: "Modules",
  actionsTitle: "Quick actions",
  open: "Open {name}",
  emptyTitle: "Nothing to open yet",
  emptyDescription: "No module is assigned to your account. Ask an administrator to grant access.",
  actions: {
    newQuotation: "New quotation",
    newOrder: "New sales order",
    newInvoice: "New sales invoice",
    newReceipt: "New receipt",
    newPurchaseOrder: "New purchase order",
    newPurchaseInvoice: "New purchase invoice",
    newJournalEntry: "New journal entry",
    newAgentOrder: "New order",
  },
} as const;

export default homeEn;
