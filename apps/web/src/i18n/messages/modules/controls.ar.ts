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
  },
} as const;

export default controlsAr;
