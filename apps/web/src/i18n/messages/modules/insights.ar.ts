/** insights namespace (ar) — Round 6 dashboards: figure scopes and period-free tile context. */
const insightsAr = {
  scope: {
    current: "الآن",
    toDate: "حتى تاريخه",
    pace: "اليوم · الأسبوع · الشهر",
  },
  company: {
    salesScope: "ضمن صلاحياتك",
    newLeads: "لم يُبدأ العمل عليها",
    converted: "تحوّلت إلى طلبات",
    conversion: "من الليدز المنشأة",
    delivered: "سُلّمت للعملاء",
    ranking: "الطلبات المنشأة دون الملغاة",
    inProgress: "لا يتأثر بالفترة",
  },
  agent: {
    ordersTitle: "الطلبات والتنفيذ",
    ordersOwn: "طلباتك",
    ordersAll: "كل طلبات الوكيل",
    stageShare: "{percent}٪ من الطلبات",
    leadsTitle: "العملاء المحتملون",
    leadsAll: "كل العملاء المحتملين",
    leadsNew: "جديد",
    leadsNewContext: "لم يُبدأ العمل عليهم",
    leadsConverted: "تم تحويلهم",
    leadsConvertedContext: "تحوّلوا إلى طلبات",
    salesTitle: "المبيعات والتحصيل",
    positionTitle: "موقف الحساب",
    openStatement: "فتح كشف الحساب",
    openPayouts: "المدفوعات",
    viewOrders: "عرض الطلبات",
    viewLeads: "عرض العملاء المحتملين",
    collectionsContext: "{count} دفعة بانتظار المالية",
  },
} as const;

export default insightsAr;
