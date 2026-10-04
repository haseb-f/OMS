/** home namespace (ar) — the permission-aware Home launcher (design-system §12.17). */
import destinations from "./home-destinations.ar";

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
  module: {
    subtitle: "اختر الصفحة التي تريد العمل عليها في {name}.",
    pagesTitle: "الصفحات",
    records: "{count} سجل",
    backToHome: "العودة إلى الشاشة الرئيسية",
    noAccessTitle: "لا يوجد ما يمكن فتحه هنا",
    noAccessDescription:
      "لا تملك صلاحية الوصول إلى أي صفحة في هذه الوحدة، أو أن الوحدة غير موجودة.",
  },
  destinations,
} as const;

export default homeAr;
