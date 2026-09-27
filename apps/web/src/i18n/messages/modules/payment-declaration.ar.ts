/** payment-declaration namespace (ar) — owned by one implementer to avoid shared-file edit races. */
const paymentDeclarationAr = {
  action: {
    declare: "إبلاغ دفع العميل",
    update: "تعديل إبلاغ الدفع",
  },
  dialog: {
    title: "إبلاغ دفع العميل",
    description:
      "سجّل ما أبلغك به العميل. هذا ليس تحققاً من المالية — المالية تتحقق وترحّل بشكل منفصل.",
    question: "هل دفع العميل؟",
    kinds: {
      UNPAID: "لم يدفع بعد",
      FULL: "دفع كامل المبلغ",
      PARTIAL: "دفع جزئي",
    },
    fullHint: "يُسجَّل المتبقي من إجمالي الطلب تلقائياً — دون إدخال مبلغ.",
    partialHint: "أدخل المبلغ الذي دفعه العميل فعلاً فقط.",
    orderTotal: "إجمالي الطلب المعتمد",
    alreadyDeclared: "المُبلَغ عنه سابقاً",
    remaining: "المتبقي للإبلاغ",
    willDeclare: "سيُبلَغ عن",
    amount: "المبلغ المدفوع",
    method: "طريقة الدفع",
    selectMethod: "اختر طريقة الدفع",
    noActiveMethods: "لا توجد طرق دفع نشطة",
    paymentDate: "تاريخ الدفع الفعلي",
    reference: "مرجع الدفع",
    currency: "العملة",
    submit: "حفظ الإبلاغ",
    notVerifiedNote: "«أبلغ العميل بالدفع» ليس «تحققت المالية/مرحّل».",
    errors: {
      amountRequired: "أدخل المبلغ الذي دفعه العميل.",
      amountExceeds: "لا يمكن أن يتجاوز المبلغ المتبقي للإبلاغ.",
      methodRequired: "اختر طريقة الدفع.",
      dateRequired: "أدخل تاريخ الدفع الفعلي.",
      dateFuture: "لا يمكن أن يكون تاريخ الدفع في المستقبل.",
      nothingRemaining: "تم الإبلاغ عن كامل إجمالي الطلب مسبقاً.",
      zeroTotal: "حدّد المبالغ المتفق عليها للبنود قبل الإبلاغ عن الدفع.",
    },
    success: {
      UNPAID: "تم تسجيل أن العميل لم يدفع بعد.",
      PAID: "تم الإبلاغ عن الدفع — بانتظار تحقق المالية.",
      retry: "تم حفظ هذا الإبلاغ مسبقاً — لم يتكرر شيء.",
    },
    failed: "تعذّر حفظ إبلاغ الدفع.",
  },
  sections: {
    declared: "إبلاغ المبيعات",
    verification: "تحقق المالية",
    settlement: "تسوية مزوّد الدفع",
  },
  declared: {
    UNPAID: "لم يدفع العميل",
    PARTIALLY_PAID: "أبلغ العميل بدفع جزئي",
    PAID: "أبلغ العميل بالدفع",
  },
  declaredShort: {
    UNPAID: "غير مُبلَغ بالدفع",
    PARTIALLY_PAID: "مُبلَغ جزئياً",
    PAID: "مُبلَغ بالدفع",
  },
  verification: {
    NONE: "لا توجد مطالبات دفع بعد",
    AWAITING: "بانتظار مطابقة المالية",
    PARTIAL: "تحقق/ترحيل جزئي",
    VERIFIED: "تحققت المالية/مرحّل",
    DISPUTED: "معترض عليه من المالية",
    REJECTED: "مرفوض من المالية",
  },
  settlement: {
    NOT_APPLICABLE: "لا ينطبق",
    AWAITING_SETTLEMENT: "بانتظار تسوية المزوّد",
    PARTIALLY_SETTLED: "مسوّى جزئياً",
    SETTLED: "مسوّى",
  },
  fields: {
    declaredAmount: "المبلغ المُبلَغ عنه",
    verifiedAmount: "المتحقق منه والمرحّل",
    method: "الطريقة",
    origin: "أبلغ بواسطة",
    kind: "نوع الإبلاغ",
    reason: "السبب",
  },
  origin: {
    LEGACY: "إدخال سابق",
    SALES_DECLARATION: "المبيعات",
    FINANCE_DECLARATION: "المالية",
    LEAD_CONVERSION: "تحويل العميل المحتمل",
  },
  kind: {
    FULL: "دفع كامل",
    PARTIAL: "جزئي",
  },
  recordStatus: {
    DISPUTED: "معترض عليه",
  },
  discrepancy: {
    title: "تعارض في الدفع",
    description:
      "اعترضت المالية على دفعة أو رفضتها بعد بدء التنفيذ. عالج الأمر مع المالية — لم يتغير سجل الشحن.",
  },
  gate: {
    notReadyHint:
      "يصبح الطلب جاهزاً للشحن بمجرد الإبلاغ عن دفع كامل المبلغ — لا يلزم انتظار تحقق المالية. الإبلاغ الجزئي لا يكفي.",
    pickupHint:
      "يمكن تسجيل الجاهزية للاستلام والاستلام بعد الإبلاغ عن دفع كامل المبلغ (أو إذا كان الطلب دفعاً عند الاستلام).",
    readyDeclared: "الدفع مُبلَغ من المبيعات — تحقق المالية ما زال قيد الانتظار.",
  },
  pickup: {
    title: "الاستلام من الفرع",
    status: "حالة الاستلام",
    actions: {
      READY_FOR_PICKUP: "جاهز للاستلام",
      COLLECTED: "تسجيل الاستلام",
      CANCELLED: "إلغاء الاستلام",
    },
    codes: {
      AWAITING_PREPARATION: "بانتظار التجهيز",
      READY_FOR_PICKUP: "جاهز للاستلام",
      COLLECTED: "تم الاستلام",
      CANCELLED: "ملغى",
      RETURNED: "مُرتجع",
    },
    confirm: {
      COLLECTED: {
        title: "تسجيل الاستلام؟",
        description: "يؤكد أن العميل استلم الطلب. لا يمكن التراجع عن ذلك.",
      },
      CANCELLED: {
        title: "إلغاء هذا الاستلام؟",
        description: "سيتم إلغاء الاستلام. لا يمكن التراجع عن ذلك.",
      },
    },
    success: "تم تحديث حالة الاستلام.",
    failed: "تعذّر تحديث حالة الاستلام.",
  },
  filter: {
    declaredStatus: "دفع العميل (المُبلَغ)",
  },
  review: {
    method: "الطريقة",
    kind: "نوع الإبلاغ",
    origin: "أبلغ بواسطة",
    debitAccount: "الحساب المدين عند الترحيل",
    debitAccountHint: "من طريقة الدفع — للعرض فقط",
    legacyReceivingAccount: "حساب الاستلام (سابق)",
    noMethodAccount: "طريقة الدفع بلا حساب",
    requiresReconciliation: "مطابقة كشف المزوّد",
    reconcileInWorkspace: "المطابقة في مساحة العمل",
    reconcileHint:
      "طريقة الدفع هذه تتطلب مطابقة كشف الحساب — يتم التأكيد بمطابقة معاملة المزوّد في مساحة عمل المطابقة الخاصة بها.",
    dispute: "اعتراض",
    disputeTitle: "الاعتراض على هذا الإبلاغ",
    disputeDescription:
      "لن تُحتسب المطالبة كمُبلَغ عنها. إذا كان الطلب قد شُحن أو استُلم يُعلَّم للمتابعة؛ ولا تتغير الشحنات أبداً.",
    disputeReason: "سبب الاعتراض",
    disputeReasonRequired: "أدخل سبب الاعتراض.",
    disputed: "تم الاعتراض على الدفعة.",
    disputeFailed: "تعذّر الاعتراض على الدفعة.",
  },
  method: {
    requiresReconciliation: "تتطلب مطابقة",
    isActive: "نشطة",
    yes: "نعم",
    no: "لا",
  },
} as const;

export default paymentDeclarationAr;
