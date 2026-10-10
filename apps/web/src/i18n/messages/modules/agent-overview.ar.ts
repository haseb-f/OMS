/** agentOverview namespace (ar) — R15 W1 agent overview cards. */
const agentOverviewAr = {
  delivered: "قيمة المُسلَّم",
  deliveredContext: "{count} طلبات مُسلَّمة",
  returnCount: "المرتجعات",
  leads: "العملاء المحتملون",
  leadsValue: "{total} · {converted} محوَّل",
  ownSalesTitle: "مبيعاتي",
  loadFailed: "تعذر تحميل النظرة العامة.",
  team: {
    title: "حسب الموظف",
    description: "طلبات كل مستخدم وعملاؤه المحتملون ومبيعاته",
    inactive: "غير نشط",
    unassigned: "غير مُسنَد",
  },
  agents: {
    title: "نظرة عامة على الوكلاء",
    description: "ملخص أداء جميع الوكلاء الآن، ثم أرقام كل وكيل على حدة.",
    activeAgents: "الوكلاء النشطون",
    agentsContext: "{total} وكيلًا إجمالًا",
    openOrders: "الطلبات المفتوحة",
    openOrdersContext: "لم تكتمل ولم تُلغَ بعد",
    withReturns: "طلبات بها مرتجعات",
    leads: "العملاء المحتملون",
    leadsContext: "{count} جديد",
    awaitingVerification: "مدفوعات بانتظار المالية",
    byAgentTitle: "حسب الوكيل",
    byAgentDescription: "أرقام كل وكيل بعملته؛ افتح البطاقة لعرض صفحة الوكيل.",
    availableForPayout: "المتاح للصرف",
  },
} as const;

export default agentOverviewAr;
