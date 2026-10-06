/** assetSchedules namespace (ar) — R13 spec C: جداول الأصول الثابتة والمصروفات المدفوعة مقدمًا وشاشات التفاصيل وروابط الفواتير. */
const assetSchedulesAr = {
  status: {
    PENDING: "معلق",
    POSTED: "مرحّل",
    CANCELLED: "ملغى",
    FAILED: "لم يُرحّل",
  },
  methods: {
    STRAIGHT_LINE: "القسط الثابت",
    DECLINING_BALANCE: "القسط المتناقص",
  },
  columns: {
    period: "الفترة",
    start: "من",
    end: "تاريخ الترحيل",
    amount: "المبلغ",
    status: "الحالة",
    journal: "قيد اليومية",
    lastError: "آخر خطأ",
    cumulative: "المجمّع",
    bookValue: "القيمة الدفترية",
    remaining: "المتبقي",
  },
  sections: {
    parameters: "البيانات",
    schedule: "جدول الإهلاك",
    recognitionSchedule: "جدول الاعتراف",
    preview: "معاينة الجدول",
    previewSummary: "{count} فترة شهرية · {start} ← {end}",
  },
  fields: {
    method: "طريقة الإهلاك",
    bookValue: "القيمة الدفترية",
    remainingDepreciable: "المتبقي للإهلاك",
    periodsPosted: "فترات مرحّلة",
    periodsPending: "فترات معلقة",
    periodsFailed: "لم تُرحّل (راجع آخر خطأ)",
    disposalDate: "تاريخ الاستبعاد",
    disposalNotes: "ملاحظات",
    sourceInvoice: "فاتورة المصدر",
    sourceLine: "سطر الفاتورة",
    remainingAmount: "الرصيد المتبقي",
    lineNet: "الصافي",
    endDateDerived: "تاريخ الانتهاء = البداية + عدد الفترات − يوم (يُحسب تلقائيًا).",
  },
  links: {
    sourceInvoice: "فاتورة المشتريات",
    capitalizationEntry: "قيد الرسملة",
    disposalEntry: "قيد الاستبعاد",
    deferralEntry: "قيد التأجيل",
    fixedAssets: "الأصول الثابتة",
    prepaidExpenses: "المصروفات المدفوعة مقدمًا",
    linkedRecord: "السجل المرتبط",
    linkedRecordPending: "يُنشأ عند تأكيد الفاتورة",
  },
  actions: {
    open: "فتح",
    processDue: "ترحيل القيود المستحقة",
    linkInvoiceLine: "ربط بسطر فاتورة مشتريات",
    unlinkInvoiceLine: "إلغاء ربط سطر الفاتورة",
    viewList: "العودة إلى القائمة",
  },
  dialogs: {
    capitalizeDescription:
      "يُرحّل قيد الرسملة ويحفظ هذا الجدول. تُرحّل كل فترة تلقائيًا عند حلول تاريخها.",
    capitalizeNeedsLife: "حدّد العمر الإنتاجي (بالأشهر) للأصل قبل الرسملة.",
    activateDescription:
      "يُرحّل الدفعة إلى المصروفات المدفوعة مقدمًا. يُرحّل كل اعتراف تلقائيًا عند انتهاء فترته.",
    processDueDescription:
      "يُرحّل كل إهلاك واعتراف بمصروف مدفوع مقدمًا انتهت فترته (اليوم بتوقيت القاهرة). لا يُرحّل أي قيد مرتين.",
    disposeDescription:
      "يُرحّل الإهلاك حتى تاريخ الاستبعاد أولًا، ثم تُلغى الفترات المتبقية ويُستبعد الأصل.",
    linkDescription:
      "اختر سطر أصل ثابت في فاتورة مشتريات مسودة. عند تأكيد الفاتورة يُرسمل هذا الأصل بها (التكلفة = صافي السطر) — بلا أصل ثانٍ ولا قيد ثانٍ.",
    linkPlaceholder: "ابحث برقم الفاتورة أو المرجع أو المورد",
    noLinkableLines: "لا توجد أسطر أصول ثابتة غير مرتبطة في فواتير مشتريات مسودة.",
    linkedNotice: "مرتبط بـ {invoice}. يُرسمل هذا الأصل عند تأكيد تلك الفاتورة.",
  },
  toasts: {
    processed: "تم ترحيل {posted} قيد.",
    processedWithFailures: "تم ترحيل {posted} قيد؛ وتعذّر ترحيل {failed} — راجع آخر خطأ في الجدول.",
    nothingDue: "لا يوجد مستحق — كل فترة انتهت مرحّلة بالفعل.",
    linked: "تم ربط سطر الفاتورة.",
    unlinked: "تم إلغاء ربط سطر الفاتورة.",
  },
} as const;

export default assetSchedulesAr;
