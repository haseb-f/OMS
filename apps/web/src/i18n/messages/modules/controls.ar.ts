/** controls namespace (ar) — shared copy / password / table-width / bulk-result controls (R6 workstream B). */
const controlsAr = {
  copy: {
    action: "نسخ",
    actionNamed: "نسخ {label}",
    copied: "تم النسخ",
    copiedNamed: "تم نسخ {label}",
    failed: "تعذّر النسخ إلى الحافظة",
    failedReason: "منع المتصفح الوصول إلى الحافظة. حدّد النص وانسخه يدويًا باستخدام Ctrl+C.",
    reference: "الرقم المرجعي",
    phone: "رقم الهاتف",
    value: "القيمة",
  },
  password: {
    label: "كلمة المرور",
    generate: "إنشاء كلمة مرور قوية",
    regenerate: "إنشاء كلمة مرور أخرى",
    copied: "تم نسخ كلمة المرور",
    newPassword: "كلمة المرور الجديدة",
    resetHint:
      "أدخل كلمة مرور أو أنشئها ({min}–{max} حرفًا)، أو اتركها فارغة ليُنشئها النظام. يجب على المستخدم تغييرها عند تسجيل الدخول التالي.",
    tooShort: "يجب أن تتكون كلمة المرور من {min} إلى {max} حرفًا.",
  },
  table: {
    resetColumnWidths: "إعادة ضبط عرض الأعمدة",
    columnWidthsReset: "تمت إعادة ضبط عرض الأعمدة.",
    resizeHandle: "تغيير عرض العمود {column}",
    resizeHint: "اسحب أو استخدم مفتاحي ← → لتغيير العرض. انقر نقرًا مزدوجًا لملاءمة المحتوى.",
  },
  bulk: {
    partial: "نجح {succeeded}، وتعذّر {failed}",
    allFailed: "تعذّر تنفيذ {failed} — لم يتغيّر أي سجل",
    more: "…و{count} أخرى",
    nothingToApply: "لا يوجد ما يُطبَّق — لا يوجد سجل محدد مؤهل.",
  },
} as const;

export default controlsAr;
