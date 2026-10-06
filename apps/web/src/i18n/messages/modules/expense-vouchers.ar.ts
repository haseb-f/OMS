/** expenseVouchers namespace (ar) — R13 owner decision 2: the Expenses screen = posting expense vouchers. */
const expenseVouchersAr = {
  title: "المصروفات",
  description:
    "سجّل ما أنفقته الشركة. احفظ مسودة ثم «تأكيد وترحيل»: يُنشأ القيد تلقائيًا (من حـ المصروف إلى حـ الدفع منه).",
  addNew: "مصروف جديد",
  printTitle: "سند مصروف",
  editorTitle: "مصروف",
  empty: "لا توجد مصروفات مطابقة لهذه الفلاتر",
  fields: {
    number: "رقم المصروف",
    date: "تاريخ المصروف",
    expenseAccount: "حساب المصروف",
    description: "الوصف",
    descriptionPlaceholder: "ما الذي تم شراؤه أو دفعه",
    amount: "المبلغ",
    currency: "العملة",
    paidFrom: "مدفوع من",
    paymentMethod: "طريقة الدفع",
    counterparty: "المورد (اختياري)",
    costCenter: "مركز التكلفة",
    project: "المشروع",
    reference: "المرجع",
    journalEntry: "قيد اليومية",
    posting: "الترحيل",
    status: "الحالة",
    createdBy: "أنشئ بواسطة",
    notes: "ملاحظات",
  },
  filters: {
    status: "الحالة",
    expenseAccount: "حساب المصروف",
    paidFrom: "مدفوع من",
  },
  totals: {
    label: "الإجمالي (بدون المعكوس)",
  },
  posting: {
    notPosted: "غير مُرحّل (مسودة)",
    posted: "مُرحّل",
    reversed: "معكوس",
  },
  rate: {
    base: "فارغ = العملة الأساسية",
    value: "1 {code} = {rate} {base} · سعر {date}",
    missing:
      "لا يوجد سعر صرف لـ {code} في هذا التاريخ — أضفه من المالية ← أسعار الصرف قبل الترحيل.",
  },
  actions: {
    confirmPost: "تأكيد وترحيل",
    reverse: "عكس",
  },
  confirmDialog: {
    title: "تأكيد وترحيل هذا المصروف؟",
    description:
      "سيُرحّل قيد يومية الآن (من حـ المصروف إلى حـ الدفع منه) ولن يمكن تعديل المصروف بعد ذلك.",
  },
  reverseDialog: {
    title: "عكس هذا المصروف؟",
    description:
      "سيُرحّل قيد عكسي بتاريخ اليوم ويصبح المصروف ملغى. يُرفض إذا كانت الفترة المحاسبية لليوم مغلقة أو مقفلة.",
  },
  invoices: {
    title: "لدى {supplier} عدد {count} فاتورة شراء مفتوحة — {amount} غير مسدد",
    hint: "إذا كان هذا الدفع يسدد إحداها فسدّد الفاتورة بدلًا من ذلك. المصروف لا يسدد فاتورة أبدًا، وتسجيل تكلفة مفوترة كمصروف يسجلها مرتين.",
    payInstead: "سداد الفاتورة بدلًا من ذلك",
    remaining: "المتبقي {amount}",
  },
  validation: {
    expenseAccountRequired: "اختر حساب المصروف.",
  },
  sections: {
    dimensions: "الأبعاد",
  },
  toasts: {
    saved: "حُفظ المصروف كمسودة — لم يُرحّل شيء بعد.",
    posted: "رُحّل المصروف {number} — أُنشئ قيد اليومية.",
    reversed: "عُكس المصروف {number} — رُحّل القيد العكسي.",
  },
} as const;

export default expenseVouchersAr;
