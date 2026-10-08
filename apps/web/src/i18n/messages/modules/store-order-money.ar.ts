/** storeOrderMoney namespace (ar) — R15 W5b collections, returns, refunds. */
const storeOrderMoneyAr = {
  panel: {
    title: "التحصيل",
    loadFailed: "تعذّر تحميل الموقف المالي للطلب.",
    orderGroup: "المستحق على العميل",
    moneyGroup: "المبالغ المستلمة",
    documents: "المستندات",
    noDocuments: "لا توجد دفعات أو فواتير أو مرتجعات أو مردودات بعد.",
    figures: {
      payable: "إجمالي الطلب",
      invoiced: "المفوتر (المُسلَّم)",
      credited: "إشعارات دائنة (مرتجعات)",
      balanceDue: "الرصيد المستحق",
      declared: "مُفاد به — غير مؤكد",
      expectedFromCarrier: "متوقع من شركة الشحن",
      collected: "المحصّل (مؤكد)",
      withCarrier: "لدى شركة الشحن",
      awaitingSettlement: "بانتظار تسوية المزوّد",
      inBank: "في البنك",
      refunded: "المردود للعميل",
      refundDue: "مستحق الرد",
    },
    columns: {
      document: "المستند",
      details: "التفاصيل",
      amount: "المبلغ",
      actions: "الإجراءات",
    },
    shipment: "الشحنة رقم {number}",
    tracking: "رقم التتبع {tracking}",
    returnRequested: "مطلوب",
    returnReceived: "مُستلم",
    againstReturns: "{amount} مقابل إشعارات دائنة",
    advance: "دفعة مقدمة للطلب",
    carrierCod: "تحصيل شركة الشحن",
    receipt: "سند القبض",
    reversedReason: "معكوسة: {reason}",
    cancelled: "طلب ملغى — لا يُستحق إلا ثمن البضاعة المُسلّمة والمحتفَظ بها.",
  },
  returnNotice: {
    title: "مرتجع طلب متجر",
  },
  cod: {
    tracked:
      "تحصّل {carrier} قيمة الدفع عند الاستلام ({method}): تُحسب محصّلة عند مطابقة كشف التحصيل من شركة الشحن، وتصبح في البنك عند تسوية تحويلها.",
    notTracked:
      "تحصيل الدفع عند الاستلام غير مُتتبَّع لدى {carrier} — سجّل الدفعة عندما تحوّل شركة الشحن المبلغ.",
  },
  refundPending: {
    title: "رد مستحق: {amount}",
    body: "الإشعار الدائن لا يعني رد المبلغ للعميل. أعد المبلغ عبر بوابة الدفع أو البنك، ثم سجّل الرد هنا.",
  },
  actions: {
    requestReturn: "إرجاع",
    receive: "استلام وفحص",
    recordRefund: "تسجيل رد مبلغ",
    reverse: "عكس",
  },
  returnDialog: {
    title: "إرجاع — الطلب {order}",
    description:
      "طلب إرجاع بضاعة مُسلّمة. لا يتحرك المخزون ولا يُرحَّل شيء حتى تُستلم البضاعة وتُفحص.",
    reason: "السبب",
    reasonRequired: "اكتب سبب إرجاع العميل للبضاعة.",
    invoice: "الفاتورة",
    product: "الصنف",
    delivered: "المُسلّم",
    alreadyReturned: "المُرتجع",
    quantity: "الإرجاع",
    noLines: "أدخل كمية في سطر واحد على الأقل.",
    tooMany: "الحد الأقصى {max}.",
    nothingReturnable: "لا توجد كمية مُسلّمة قابلة للإرجاع في هذا الطلب.",
    submit: "طلب إرجاع",
    requested: "تم طلب الإرجاع {numbers}.",
  },
  receiveDialog: {
    title: "استلام وفحص — {number}",
    description:
      "سجّل حالة كل سطر مُرتجع. البضاعة السليمة تعود للمخزون، والتالفة إلى مستودع التالف؛ ويُرحَّل الإشعار الدائن عند الاستلام.",
    reason: "سبب العميل: {reason}",
    product: "الصنف",
    quantity: "الكمية",
    condition: "الحالة",
    saleable: "سليم",
    damaged: "تالف",
    warehouse: "المستودع",
    saleableDefault: "الافتراضي: مستودع المخزون الخاص بالسطر",
    damagedDefault: "الافتراضي: مستودع البضاعة التالفة",
    damagedNote:
      "البضاعة التالفة تعود بقيمتها إلى المخزون في مستودع التالف؛ وشطبها قرار مخزني مستقل لاحقًا.",
    submit: "استلام وترحيل الإشعار الدائن",
    received: "تم استلام المرتجع {number} — رُحّل الإشعار الدائن.",
  },
  refundDialog: {
    title: "تسجيل رد مبلغ — الطلب {order}",
    collected: "المحصّل",
    netInvoiced: "المستحق بعد الإشعارات الدائنة",
    refunded: "المردود سابقًا",
    refundDue: "مستحق الرد",
    customerCredit: "رصيد العميل الدائن (الأستاذ)",
    refundable: "القابل للرد الآن",
    gatewayNotice:
      "لا توجد بوابة دفع مربوطة: أعد المبلغ عبر البوابة أو البنك أولًا، ثم سجّله هنا مع مرجعه.",
    split: "تُرد الإشعارات الدائنة أولًا (الأقدم أولًا)، ثم الدفعة المقدمة للطلب.",
    recorded: "تم تسجيل الرد {number}.",
  },
  reverseDialog: {
    title: "عكس الدفعة {number}",
    description:
      "فقط لدفعة أُكّدت بالخطأ. يُعكس سند القبض بقيد عكسي، وتُعلَّم الدفعة «معكوسة» مع السبب، ويُعاد حساب رصيد الطلب. لا يُحذف شيء.",
    reason: "السبب",
    reasonRequired: "السبب مطلوب.",
    submit: "عكس الدفعة",
    reversed: "تم عكس الدفعة {number}.",
    blocked: {
      SETTLED: "مدرجة في تسوية مرحّلة — اعكس التسوية أولًا.",
      MATCHED: "مطابقة مع كشف المزوّد — صحّح المطابقة من مطابقة المدفوعات.",
      AGENT_RECEIVED: "استلمها الوكيل — تُعالَج من تحصيلات الوكلاء.",
    },
  },
  carrier: {
    codMethod: "طريقة تحصيل الدفع عند الاستلام",
    codMethodHelp:
      "النقد الذي تحصّله شركة الشحن عند التسليم. يُسجَّل المبلغ المتوقع على الطلب عند التسليم، ويُطابق كشف التحصيل من شركة الشحن ككشف لهذه الطريقة، ويُسوّى تحويلها إلى البنك. تظهر فقط الطرق التي تتطلب مطابقة ولها حساب تسوية؛ اتركها فارغة لتسجيل دفعات الدفع عند الاستلام يدويًا.",
    notTracked: "غير مُتتبَّع",
  },
} as const;

export default storeOrderMoneyAr;
