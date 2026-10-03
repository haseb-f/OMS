/** tableViews namespace (ar) - R7 A: density control, Table/Grid switch, grid cards, "new to you". */
const tableViewsAr = {
  density: {
    label: "كثافة الصفوف",
    current: "كثافة الصفوف: {value}",
    compact: "مضغوطة",
    comfortable: "مريحة",
    compactHint: "صفوف أكثر في الشاشة",
    comfortableHint: "مساحة أوسع لكل صف",
  },
  view: {
    label: "طريقة العرض",
    table: "عرض الجدول",
    grid: "عرض البطاقات",
  },
  sort: {
    label: "ترتيب حسب",
    ascending: "تصاعدي",
    descending: "تنازلي",
  },
  card: {
    nextAction: "التالي:",
    selectRow: "تحديد {name}",
    actions: "الإجراءات",
    newToYou: "جديد لك",
    newToYouHint: "لم تفتح هذا العميل المحتمل بعد",
  },
  leadNext: {
    ASSIGN: "إسناد إلى موظف",
    CONVERT: "تحويل إلى طلب",
    FOLLOW_UP_OVERDUE: "متابعة متأخرة",
    FOLLOW_UP_TODAY: "متابعة اليوم",
    FOLLOW_UP_TOMORROW: "متابعة غدًا",
    FOLLOW_UP_LATER: "متابعة {date}",
    FIRST_CONTACT: "التواصل الأول",
    SCHEDULE_FOLLOW_UP: "جدولة متابعة",
  },
} as const;

export default tableViewsAr;
