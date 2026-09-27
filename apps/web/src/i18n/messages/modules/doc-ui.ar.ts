/** docUi namespace (ar) — document editors, totals, dashboard and store-order status (SC-DOCS). */
const docUiAr = {
  totals: {
    title: "الإجماليات",
    totalDebit: "إجمالي المدين",
    totalCredit: "إجمالي الدائن",
    difference: "الفرق",
    balanced: "متوازن",
    unbalanced: "غير متوازن",
    amount: "المبلغ",
    allocated: "المخصص",
    unallocated: "غير المخصص",
    overAllocated: "تخصيص زائد",
  },
  validation: {
    fixFields: "صحّح الحقول المميزة — لم يُفقد أي شيء أدخلته.",
  },
  lines: {
    lineNumber: "السطر {number}",
    showDetails: "إظهار مركز التكلفة والمشروع",
    hideDetails: "إخفاء مركز التكلفة والمشروع",
  },
  statusStrip: {
    label: "حالة الطلب",
    declared: "إبلاغ المبيعات",
    verified: "تحقق المالية",
    fulfillment: "التنفيذ",
    shipping: "الشحن",
    duplicate: "مكرر",
    invoicePayment: "الدفع",
    paymentGroup: "الدفع",
    fulfillmentGroup: "التنفيذ والشحن",
    paymentType: "النوع",
  },
  dashboard: {
    period: "الفترة",
    salesTitle: "أداء المبيعات",
    pendingTitle: "أعمال بانتظارك",
    paymentReview: "مدفوعات بانتظار المراجعة",
    paymentReviewHint: "مُبلَغ عنها ولم تُتحقق بعد",
    bankUnmatched: "حركات بنكية غير مطابقة",
    bankReview: "حركات بنكية تحتاج مراجعة",
    loadFailed: "تعذّر تحميل هذه الأرقام.",
    emptyTitle: "لا شيء بانتظارك",
    emptyDescription: "لا تنطبق مؤشرات لوحة التحكم على دورك. اختصاراتك أدناه.",
    shortcuts: "اختصاراتك",
    noShortcuts: "ثبّت صفحة من القائمة الجانبية لتظهر هنا.",
    rank: "#{rank} من {of}",
    ordersCount: "{count} طلبات",
  },
};

export default docUiAr;
