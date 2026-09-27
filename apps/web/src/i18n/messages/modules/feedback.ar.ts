/** feedback namespace (ar) — form error summary, success links, long-task progress, persistent alerts (design-system §11.4). */
const feedbackAr = {
  formErrors: {
    title: "لم يتم الحفظ — حقول تحتاج إلى مراجعة: {count}",
    guidance: "اختر أي بند للانتقال إلى الحقل المعني، صحّحه ثم احفظ مرة أخرى.",
    announce: "لم يتم الحفظ. عدد المشكلات التي تحتاج إلى مراجعة: {count}.",
    formLevel: "تعذر الحفظ",
  },
  server: {
    duplicate: "هذه القيمة مستخدمة في سجل آخر. أدخل قيمة مختلفة.",
    required: "هذا الحقل مطلوب.",
    invalid: "رفض الخادم هذه القيمة. تحقق منها وحاول مرة أخرى.",
  },
  /** Friendly schema messages layered over zod's locale (see lib/zod-error-map.ts). */
  validation: {
    required: "هذا الحقل مطلوب",
    minLength: "يجب ألا يقل عن {n} أحرف",
    maxLength: "يجب ألا يزيد عن {n} حرفًا",
    minValue: "يجب أن تكون القيمة ≥ {n}",
    minValueExclusive: "يجب أن تكون القيمة > {n}",
    maxValue: "يجب أن تكون القيمة ≤ {n}",
    maxValueExclusive: "يجب أن تكون القيمة < {n}",
    invalidFormat: "صيغة غير صحيحة",
  },
  success: {
    openRecord: "فتح السجل",
  },
  task: {
    running: "جارٍ التنفيذ…",
    succeeded: "اكتمل",
    partial: "اكتمل مع أخطاء",
    failed: "فشل",
    cancelled: "أُلغي",
    processedOf: "تمت معالجة {processed} من {total}",
    processingTotal: "جارٍ معالجة {total} صف…",
    processed: "تمت معالجته",
    succeededCount: "نجح",
    failedCount: "فشل",
    skippedCount: "تم تخطيه",
    total: "الإجمالي",
    errorsTitle: "الأخطاء",
    showAll: "عرض الكل ({count})",
    showFewer: "عرض أقل",
    retry: "إعادة المحاولة",
    cancel: "إلغاء",
    announceProgress: "تمت معالجة {processed} من {total}.",
    announceDone: "{status}. نجح {succeeded}، وفشل {failed}.",
  },
  alert: {
    dismiss: "إخفاء",
  },
  import: {
    jobCancelled: "تم إلغاء مهمة الاستيراد.",
    running: "جارٍ استيراد {count} صف… أبقِ هذه النافذة مفتوحة.",
    startOver: "بدء استيراد جديد",
    runFailed: "لم يكتمل الاستيراد. راجع السبب أدناه ثم أعد المحاولة.",
    failed: "فشل الاستيراد",
  },
  sync: {
    writebackWarning: "تم استيراد الصفوف، لكن تعذرت كتابة النتائج في الجدول.",
    resultTitle: "نتيجة آخر مزامنة",
  },
} as const;

export default feedbackAr;
