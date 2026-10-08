/** salesImport namespace (ar) — R15 W2 lead / store-order imports. */
const salesImportAr = {
  nav: {
    agentImports: "الاستيراد",
  },
  fields: {
    lineAmount: "إجمالي السطر",
    paymentDate: "تاريخ الدفع",
    repeatCustomer: "عميل متكرر",
  },
  actions: {
    menu: "استيراد",
    myImports: "عمليات الاستيراد الخاصة بي",
    importLeads: "استيراد عملاء محتملين",
    importOrders: "استيراد طلبات",
  },
  agentPage: {
    title: "الاستيراد",
    description:
      "استورد العملاء المحتملين والطلبات إلى حسابك من Excel أو من جدول Google خاص — بنفس قواعد الإدخال اليدوي.",
    noPermission: "لا تملك صلاحية استيراد.",
  },
  history: {
    title: "عمليات الاستيراد الخاصة بي",
    description: "عمليات الاستيراد التي أنشأتها — افتح أيًّا منها لعرض النتائج أو متابعتها.",
    type: "النوع",
    skipped: "متجاوزة",
    empty: "لا توجد عمليات استيراد بعد.",
  },
  summary: {
    new: "جديدة",
    created: "أُنشئت",
    skipped: "متجاوزة — مستوردة سابقًا",
    needsReview: "بانتظار المراجعة",
    rejected: "مرفوضة",
    duplicate: "مكررة داخل الملف",
    total: "الصفوف",
  },
  outcome: {
    REJECTED: "مرفوض",
    NEEDS_REVIEW: "بانتظار المراجعة",
    REVIEW_REJECTED: "مرفوض بعد المراجعة",
    SKIPPED: "متجاوز",
    CREATED_NOTICE: "أُنشئ — ملاحظة",
  },
  preview: {
    warningsTitle: "قبل الاستيراد",
    skippedTitle: "موجودة في النظام — ستُتجاوز هذه الصفوف",
    needsReviewTitle: "ستحتاج إلى مراجعتك",
    fileWarning: "الملف",
  },
  mapping: {
    autoMapped: "تمت مطابقة {count} عمودًا تلقائيًا — راجعها قبل المتابعة.",
  },
  sheets: {
    shareTitle: "شارك الجدول مع النظام",
    shareHint:
      "من Google Sheets اختر «مشاركة» وأضف هذا العنوان بصلاحية «عارض». يبقى الجدول خاصًا — لا يلزم جعله عامًا أبدًا.",
    copy: "نسخ العنوان",
    copied: "تم نسخ العنوان.",
    connected: "الجداول المربوطة بحسابك",
    disconnect: "فصل",
    disconnected: "تم فصل الجدول.",
    unavailable: "تكامل Google Sheets غير مُعدّ على هذا الخادم.",
  },
  review: {
    title: "صفوف تحتاج إلى مراجعتك",
    description:
      "التأكيد ينشئ الطلب للعميل المطابق كطلب جديد (متكرر)؛ الرفض يُبقي الصف خارج النظام مع سببك.",
    confirm: "تأكيد",
    reject: "رفض",
    confirmed: "تم تأكيد الصف.",
    rejected: "تم رفض الصف.",
    rejectTitle: "رفض هذا الصف؟",
  },
} as const;

export default salesImportAr;
