/** home namespace (ar) — the permission-aware Home launcher (design-system §12.17). */
const homeAr = {
  title: "الشاشة الرئيسية",
  subtitle: "افتح أي وحدة تملك صلاحية الوصول إليها.",
  modulesTitle: "الوحدات",
  actionsTitle: "إجراءات سريعة",
  open: "فتح {name}",
  emptyTitle: "لا يوجد ما يمكن فتحه بعد",
  emptyDescription: "لا توجد وحدة مرتبطة بحسابك. اطلب من المسؤول منحك الصلاحيات.",
  actions: {
    newQuotation: "عرض سعر جديد",
    newOrder: "طلب مبيعات جديد",
    newInvoice: "فاتورة مبيعات جديدة",
    newReceipt: "سند قبض جديد",
    newPurchaseOrder: "أمر شراء جديد",
    newPurchaseInvoice: "فاتورة شراء جديدة",
    newJournalEntry: "قيد يومية جديد",
    newAgentOrder: "طلب جديد",
  },
} as const;

export default homeAr;
