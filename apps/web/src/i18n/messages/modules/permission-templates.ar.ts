/** permissionTemplates namespace (ar) — R14 W2: job-title permission templates, individual overrides, carrier authorization. */
const permissionTemplatesAr = {
  source: {
    inherited: "موروثة من المسمى الوظيفي",
    grant: "منحة فردية",
    deny: "منع فردي",
    alsoInherited: "موروثة أيضًا",
  },
  state: {
    label: "مصدر الصلاحية",
    inherit: "وراثة",
    grant: "منح",
    deny: "منع",
  },
  actions: {
    assignCarrier: "تعيين شركة الشحن ورقم الشحنة",
    managePermissions: "إدارة الصلاحيات",
  },
  userPanel: {
    inheritsFrom: "يرث الصلاحيات الافتراضية للمسمى «{title}».",
    noJobTitle: "لا يوجد مسمى وظيفي — تُطبَّق المنح الفردية فقط.",
    reviewRequired: "تغيّر المسمى الوظيفي. راجع المنح والمنع الفردي ثم احفظ لإزالة هذا التنبيه.",
    selfEdit: "لا يمكنك تعديل صلاحياتك الفردية.",
    readOnly: "عرض فقط — يلزم صلاحية «إدارة الصلاحيات» لتعديلها.",
    summary: "{grants} منحة فردية · {denies} منع فردي",
  },
  reviewBadge: "مراجعة الصلاحيات",
  jobTitle: {
    action: "الصلاحيات الافتراضية",
    title: "الصلاحيات الافتراضية — {name}",
    description: "تُطبَّق فورًا على كل من يحمل هذا المسمى الوظيفي ({count}).",
    seedFromUser: "البدء من مستخدم",
    seedLoad: "تحميل منحه",
    seeded: "تم تحميل منح المستخدم — راجعها ثم احفظ.",
    reviewImpact: "مراجعة الأثر",
    back: "رجوع",
    confirmSave: "حفظ وتطبيق",
    impactSummary: "إضافة {added} · إزالة {removed} · يتغير {affected} من {holders} مستخدم",
    noImpact: "لا تتغير الصلاحيات الفعلية لأي مستخدم.",
    columnUser: "المستخدم",
    columnGained: "يكتسب",
    columnLost: "يفقد",
    columnIneffective: "غير مؤثر بسبب",
    ineffectiveDenied: "{permission} — ممنوعة فرديًا",
    ineffectiveGranted: "{permission} — ممنوحة فرديًا",
    saved: "تم حفظ الصلاحيات الافتراضية وتطبيقها على {count} مستخدم.",
    noChanges: "لا توجد تغييرات للحفظ.",
    readOnly: "عرض فقط — يلزم صلاحية «إدارة الصلاحيات» لتعديل الافتراضيات.",
  },
  shipping: {
    carrierReadOnly:
      "شركة الشحن ورقم الشحنة للعرض فقط — يلزم صلاحية «تعيين شركة الشحن ورقم الشحنة».",
  },
} as const;

export default permissionTemplatesAr;
