/** customerHistory namespace (ar) — Round 14 customer history, repeat-customer badge and the full-disclosure card. */
const customerHistoryAr = {
  repeat: {
    label: "عميل متكرر · {count} طلبات",
    tooltip: "{count} مشتريات مكتملة",
  },
  card: {
    latestOrder: "آخر طلب",
    noOrders: "لا توجد طلبات بعد",
    placedOrders: "{count} طلبات",
  },
  tabs: {
    orders: "الطلبات",
    leads: "العملاء المحتملون",
    history: "السجل الزمني",
  },
  summary: {
    placed: "الطلبات",
    completed: "المشتريات المكتملة",
    lastOrder: "آخر طلب",
    outstanding: "الرصيد المستحق",
  },
  orders: {
    empty: "لا توجد طلبات لهذا العميل.",
    otherOrders: "{count} طلبات أخرى لدى موظفين آخرين",
    loadFailed: "تعذر تحميل طلبات العميل.",
    columns: {
      number: "رقم الطلب",
      date: "التاريخ",
      products: "المنتجات",
      fulfillment: "التنفيذ",
      payment: "الدفع",
      total: "الإجمالي",
    },
    type: {
      STORE: "طلب متجر",
      B2B: "أمر بيع",
    },
  },
  leads: {
    empty: "لا يوجد عملاء محتملون مرتبطون بهذا العميل.",
  },
  payments: {
    title: "تحصيلات الطلبات",
    empty: "لا توجد دفعات مسجلة على طلبات هذا العميل.",
    order: "الطلب",
  },
  timeline: {
    empty: "لا توجد أحداث بعد.",
    kind: {
      ORDER: "طلب جديد",
      DELIVERY: "تم التسليم",
      RETURN: "مرتجع",
      CANCELLATION: "إلغاء الطلب",
      PAYMENT: "دفعة مستلمة",
    },
  },
} as const;

export default customerHistoryAr;
