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
    costAdditions: "تكاليف مضافة",
    settlement: "تسوية المتحصلات",
    supplierToCredit: "المورد الدائن",
    refundTo: "الاسترداد إلى",
    refundedAmount: "المسترد من المورد",
    actionDate: "التاريخ",
    closedOn: "أُغلق في",
    closure: "طريقة الإغلاق",
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
    purchaseReturn: "مرتجع المشتريات",
    costAddedBy: "تكاليف مضافة من",
    refundEntry: "قيد الاسترداد",
    accelerationEntry: "قيد الاعتراف بالمتبقي",
  },
  actions: {
    open: "فتح",
    processDue: "ترحيل القيود المستحقة",
    linkInvoiceLine: "ربط بسطر فاتورة مشتريات",
    unlinkInvoiceLine: "إلغاء ربط سطر الفاتورة",
    viewList: "العودة إلى القائمة",
    cancelWithRefund: "إلغاء مع استرداد",
    recognizeRemaining: "الاعتراف بالمتبقي الآن",
    addToExistingAsset: "إضافة إلى أصل قائم",
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
    disposeSupplierHint:
      "إشعار دائن من المورد: تُخفِّض المتحصلات المستحق للمورد (مدين حسابات الدائنين) بدلًا من النقدية. يُحسب الربح أو الخسارة بالطريقة نفسها.",
    cancelRefundDescription:
      "تُرحَّل أولًا الاعترافات المستحقة حتى التاريخ. يُسترد الرصيد غير المعترف به ({amount}) من المورد وتُلغى الفترات المتبقية.",
    recognizeRemainingDescription:
      "تُرحَّل أولًا الاعترافات المستحقة حتى التاريخ. يُحمَّل الرصيد غير المعترف به ({amount}) على المصروف في ذلك التاريخ وتُلغى الفترات المتبقية.",
    returnedNotice:
      "أُعيد إلى المورد بموجب {return}. قيد المرتجع ألغى الاعتراف بالأصل — دون قيد استبعاد منفصل.",
    closedNotice: "{closure} في {date}.",
    addToAssetHint:
      "يضيف تكلفة هذا السطر (توصيل، تركيب…) إلى أصل قائم بدلًا من إنشاء أصل جديد، ويُعاد احتساب إهلاكه المتبقي.",
    addToAssetPlaceholder: "أصل جديد من هذا السطر",
    noCostAdditionTargets: "لا يوجد أصل مسودة أو مرسمل له فترات متبقية.",
  },
  toasts: {
    processed: "تم ترحيل {posted} قيد.",
    processedWithFailures: "تم ترحيل {posted} قيد؛ وتعذّر ترحيل {failed} — راجع آخر خطأ في الجدول.",
    nothingDue: "لا يوجد مستحق — كل فترة انتهت مرحّلة بالفعل.",
    linked: "تم ربط سطر الفاتورة.",
    unlinked: "تم إلغاء ربط سطر الفاتورة.",
    cancelled: "أُلغي المصروف المقدم — واستُرد الرصيد المتبقي.",
    recognizedRemaining: "تم الاعتراف بالرصيد المتبقي.",
  },
  settlement: {
    CASH: "نقدية مستلمة",
    SUPPLIER_CREDIT: "إشعار دائن من المورد",
  },
  closureTypes: {
    REFUND: "أُلغي مع استرداد",
    RECOGNIZED: "اعتُرف بالمتبقي",
    PURCHASE_RETURN: "أُلغي بمرتجع مشتريات",
  },
  returns: {
    wholeLineOnly: "أصل ثابت — يُرتجع السطر كاملًا",
    blocked: "لا يمكن إرجاعه",
  },
} as const;

export default assetSchedulesAr;
