/** productCommission namespace (ar) — item commission setting of an agent-owned product (commission-policy.md A4). */
const productCommissionAr = {
  title: "العمولة",
  description:
    "نسبة عمولة الوكيل المطبقة على هذا الصنف. تستخدم الطلبات الجديدة الإعداد الساري في تاريخها، وتحتفظ الطلبات السابقة بنسبتها.",
  ownership: "الملكية",
  ownershipValue: {
    COMPANY: "مملوك للشركة",
    AGENT: "مملوك لوكيل",
  },
  owner: "الوكيل المالك",
  class: "فئة العمولة",
  classValue: {
    PRODUCT: "منتج",
    SERVICE: "خدمة / دورة",
    UNSET: "غير مصنّف — حدّد نوع الصنف",
  },
  classHint: "يُحدَّد في حقل «نوع الصنف» (مستقل عن تتبع المخزون).",
  itemType: {
    label: "نوع الصنف",
    PRODUCT: "منتج (مخزني أو غير مخزني)",
    SERVICE: "خدمة / دورة",
    UNSET: "غير مصنّف — يحتاج مراجعة",
    hint: "يحدد نسبة عمولة الوكيل (منتج أو خدمة). تتبع المخزون إعداد منفصل.",
  },
  source: "مصدر العمولة",
  sourceValue: {
    INHERIT: "حسب اتفاقية الوكيل",
    OVERRIDE: "نسبة خاصة بالصنف",
  },
  currentRate: "النسبة الحالية",
  loadFailed: "تعذر تحميل إعداد العمولة.",
  form: {
    title: "تغيير الإعداد",
    ratePercent: "النسبة الخاصة (%)",
    zeroHint: "النسبة 0% قيمة صريحة مسموح بها.",
    effectiveFrom: "تاريخ السريان",
    effectiveFromHint: "يجب أن يكون بعد بداية كل إعداد سابق — لا يُعاد كتابة السجل.",
    reason: "السبب",
    save: "حفظ إعداد العمولة",
    saved: "تم حفظ إعداد العمولة.",
    rateRequired: "أدخل النسبة الخاصة (من 0 إلى 100).",
    effectiveFromRequired: "اختر تاريخ السريان.",
  },
  history: {
    title: "سجل النسب الخاصة",
    rate: "النسبة",
    from: "من",
    to: "إلى",
    reason: "السبب",
    openEnded: "مفتوح",
    empty: "لا توجد نسب خاصة — تُطبق نسبة اتفاقية الوكيل.",
  },
} as const;

export default productCommissionAr;
