/** storeOrderRecognition namespace (ar) — R14 W3: إثبات الإيراد وصرف المخزون والتكلفة عند التسليم. */
const storeOrderRecognitionAr = {
  label: "إثبات البيع",
  status: {
    NOT_DUE: "غير مستحق بعد",
    RESERVED: "مخزون محجوز",
    RECOGNIZED: "تم الإثبات",
    FAILED: "فشل الإثبات",
    RETURN_PENDING: "مرتجع قيد المعالجة",
  },
  failed: {
    title: "تم حفظ التسليم، لكن تعذّر إثبات البيع",
    description:
      "لم تُصدر فاتورة ولم يُصرف المخزون ولم تُرحَّل تكلفة البضاعة المباعة لهذا الطلب المُسلَّم. عالج السبب أدناه ثم أعد المحاولة.",
    lastAttempt: "آخر محاولة: {date}",
  },
  reservationFailed: {
    title: "تعذّر حجز المخزون لهذه الشحنة",
    description: "تم حفظ حالة الشحنة. عالج السبب أدناه — سيُعاد إثبات البيع تلقائياً عند التسليم.",
  },
  returnPending: {
    title: "مرتجع بعد التسليم",
    description:
      "سجّل مرتجع مبيعات على الفاتورة {invoice} بعد فحص البضاعة — يعيد الأصناف للمخزون ويعكس التكلفة.",
  },
  retry: "إعادة محاولة الإثبات",
  retrying: "جارٍ إعادة المحاولة…",
  retried: "تم إثبات البيع — صدرت الفاتورة وصُرف المخزون ورُحّلت التكلفة.",
} as const;

export default storeOrderRecognitionAr;
