/** agentPricing namespace (ar) — ربط منتجات الوكيل وتعرفة الشحن (specs/order-operations-r5/spec-2-agent-pricing.md). */
const agentPricingAr = {
  ownership: {
    label: "الملكية",
    COMPANY: "الشركة",
    AGENT: "وكيل",
    agent: "الوكيل المالك",
    agentRequired: "اختر الوكيل المالك.",
    hint: "منتجات الوكيل تُباع عبره فقط. تُقفل الملكية بعد وجود حركات مخزون أو طلبات أو عملاء محتملين أو مستندات على المنتج.",
  },
  itemType: {
    required: "اختر منتج أو خدمة.",
    hint: "منتج أو خدمة — مستقل عن تتبّع المخزون.",
  },
  commissionDraft: {
    title: "عمولة الوكيل",
    description: "تُحفظ مع المنتج. الطلبات الجديدة تستخدم الإعداد الساري في تاريخها.",
    source: "مصدر العمولة",
    ratePercent: "النسبة الخاصة (%)",
    rateRequired: "أدخل النسبة الخاصة (من 0 إلى 100).",
    zeroHint: "النسبة 0% قيمة صريحة مقبولة.",
  },
  products: {
    title: "منتجات الوكيل",
    description: "منتجات تُباع عبر هذا الوكيل فقط. العمولة المعروضة هي السارية اليوم.",
    link: "ربط منتج موجود",
    linkTitle: "ربط منتج من منتجات الشركة",
    linkDescription:
      "ينتقل المنتج إلى هذا الوكيل. مسموح فقط قبل وجود حركات مخزون أو طلبات أو عملاء محتملين أو مستندات عليه.",
    linkSearch: "ابحث بالاسم أو رمز المنتج",
    linkEmpty: "لا يوجد منتج مملوك للشركة مطابق.",
    linkAction: "ربط المنتج",
    linked: "تم ربط المنتج بالوكيل.",
    newProduct: "منتج جديد لهذا الوكيل",
    unlink: "فك الربط",
    unlinkTitle: "إعادة المنتج إلى الشركة؟",
    unlinkDescription:
      "سيعود {product} مملوكًا للشركة. يُرفض ذلك بعد وجود حركات مخزون أو طلبات أو عملاء محتملين أو مستندات عليه.",
    unlinked: "أُعيد المنتج إلى الشركة.",
    commissionAction: "العمولة",
    commissionTitle: "عمولة الصنف — {product}",
    empty: "لا توجد منتجات مرتبطة بهذا الوكيل بعد.",
    emptyHint: "اربط منتجًا موجودًا من منتجات الشركة أو أنشئ منتجًا جديدًا لهذا الوكيل.",
    columns: {
      product: "المنتج",
      itemType: "نوع الصنف",
      status: "الحالة",
      commission: "العمولة",
    },
    itemTypeValue: {
      PRODUCT: "منتج",
      SERVICE: "خدمة",
      UNSET: "غير محدد",
    },
    commissionSource: {
      OVERRIDE: "نسبة خاصة بالصنف",
      AGREEMENT: "الاتفاقية",
    },
    missing: {
      NO_ACTIVE_AGREEMENT: "لا توجد اتفاقية سارية",
      AGENT_ITEM_TYPE_REQUIRED: "نوع الصنف غير محدد",
      AGENT_COMMISSION_RATE_MISSING: "لا توجد نسبة لهذا النوع",
    },
  },
  emptyCatalog: {
    title: "لا توجد منتجات متاحة",
    agent:
      "لا توجد منتجات مرتبطة بوكيلك بعد. اطلب من مسؤول الوكيل أو من مدير الوكلاء في الشركة ربط المنتجات.",
  },
  tariffs: {
    title: "تعرفة شحن الوكيل",
    description: "رسم شحن الوكيل التعاقدي حسب الوجهة وطريقة التوصيل ونوع الدفع. شحن العميل يتبعه.",
    channel: "طريقة التوصيل",
    paymentType: "نوع الدفع",
    channels: {
      ANY: "أي طريقة",
      CARRIER: "شركة شحن",
      INTERNAL_COURIER: "مندوب داخلي",
    },
    paymentTypes: {
      ANY: "أي نوع",
      PREPAID: "مدفوع مسبقًا",
      CASH_ON_DELIVERY: "الدفع عند الاستلام",
    },
    matrixTitle: "الرسم المعتمد لكل وجهة",
    matrixHint:
      "يُطبَّق الصف الأكثر تحديدًا: المدينة ثم طريقة التوصيل ثم نوع الدفع. «غير محدد» يعني أن قسم الشحن لا يستطيع اختيار تلك الطريقة لهذه الوجهة.",
    destination: "الوجهة",
    notConfigured: "غير محدد",
    rowsTitle: "صفوف التعرفة",
    add: "إضافة تعرفة",
    saved: "تم حفظ التعرفة.",
  },
  status: {
    NOT_APPLICABLE: "لا ينطبق",
    PENDING_METHOD: "مبدئي",
    CONFIRMED: "مؤكد",
  },
  provisionalNote: "مبدئي — يصبح نهائيًا عندما يحدد قسم الشحن طريقة التوصيل",
  shippingProvisional: "مبدئي",
  payablePending: "{merchandise} + الشحن (قيد التحديد)",
  payableEstimate: "تقديري {amount}",
  panel: {
    title: "تسعير الشحن",
    customerShipping: "شحن العميل",
    agentFee: "رسم شحن الوكيل (تعاقدي)",
    method: "طريقة التوصيل",
    methodPending: "لم تُحدد بعد",
    carrierCost: "تكلفة الناقل الفعلية",
    carrierEstimate: "تقديري {amount}",
    carrierNone: "لم تُسجّل بعد",
    margin: "هامش الشحن (للشركة)",
    marginBasis: {
      ACTUAL: "تكلفة ناقل معتمدة",
      ESTIMATE: "تكلفة ناقل تقديرية",
    },
    marginUnavailable: "غير قابل للمقارنة بعد",
    differenceBorne: "نقص الشحن (تتحمله الشركة)",
    differenceKept: "زيادة الشحن (للشركة)",
    internalOnly: "داخلي فقط — لا يظهر للوكيل.",
  },
  customerTotal: {
    label: "إجمالي العميل",
    status: {
      NONE: "—",
      CONFIRMATION_REQUIRED: "بانتظار موافقة العميل",
      CONFIRMED: "وافق العميل",
    },
    requiredTitle: "ارتفع إجمالي العميل",
    requiredDescription:
      "الشحن المؤكد يرفع إجمالي العميل من {previous} إلى {proposed}. سجّل موافقة العميل قبل مطالبته؛ وحتى ذلك يبقى {previous} هو المبلغ المطلوب تحصيله.",
    confirm: "وافق العميل على دفع {total}",
    confirmTitle: "تسجيل موافقة العميل؟",
    confirmDescription:
      "يصبح إجمالي الطلب {total} (الشحن {shipping}). يُسجَّل التغيير في سجل الطلب.",
    confirmed: "سُجّلت موافقة العميل — الإجمالي الجديد {total}.",
    paid: "المدفوع",
    newPayable: "المستحق الجديد",
    outstanding: "المتبقي",
  },
  report: {
    portalDescription: "العمولة لكل صنف والشحن المحتجز وما تستحقه — بمعزل عن النقد المتاح للصرف.",
    portalNote: "الاستحقاق هو ما كسبته؛ ووحده المركز النقدي يبيّن ما يمكن صرفه الآن.",
    margin: "هامش الشحن",
  },
} as const;

export default agentPricingAr;
