/** orderEntry namespace (ar) — R15 W1 shared order-entry flow (company + agent). */
const orderEntryAr = {
  availability: {
    title: "بعض المنتجات غير متوفرة بالكمية المطلوبة",
    line: "{product}: المطلوب {requested}، المتاح {available}",
    hint: "سيُحفظ الطلب رغم ذلك بحالة مخزون «ناقص» دون حجز البند الناقص؛ بعد توفر المخزون اضغط «احجز الآن» في صفحة الطلب.",
    available: "المتاح {count}",
  },
  agent: {
    newOrder: "طلب جديد للوكيل",
    staffTitle: "طلب جديد لـ {agent}",
    staffDescription:
      "يُسجَّل نيابةً عن الوكيل — يُطبَّق كتالوج الوكيل واتفاقيته ورسوم الشحن الخاصة به.",
    owner: "مسؤول الطلب",
    ownerHint: "مستخدم الوكيل المسؤول عن هذا الطلب. فارغ: المسؤول الافتراضي لدى الوكيل.",
    leadCustomer: "العميل من العميل المحتمل {number}",
    openLead: "فتح العميل المحتمل",
    quotePending: "انتظر انتهاء التحقق من الأسعار قبل إنشاء الطلب.",
    quoteInvalid: "صحّح مشكلات الأسعار قبل إنشاء الطلب.",
    declarationTitle: "الدفعة المستلمة",
    unavailableDestinations: "لم تُضبط وجهة دفع لهذا الوكيل بعد.",
  },
} as const;

export default orderEntryAr;
