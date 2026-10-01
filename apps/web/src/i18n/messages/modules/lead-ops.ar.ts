/** leadOps namespace (ar) — R6 spec C: follow-up classification + the distribution status button/dialog. */
const leadOpsAr = {
  outcome: {
    label: "تصنيف المتابعة",
    none: "بدون نتيجة بعد",
    all: "كل التصنيفات",
    recordedAt: "آخر نتيجة: {time}",
  },
  distribution: {
    button: {
      active: "التوزيع نشط",
      activeUntil: "التوزيع نشط حتى {time}",
      paused: "التوزيع متوقف",
      manual: "التوزيع يدوي",
      blocked: "التوزيع متعطّل",
      pending: "{count} بانتظار التوزيع",
      busy: "جارٍ التوزيع…",
    },
    dialog: {
      title: "توزيع الليدز",
      description: "اختر الوضع ثم أكّد — الاختيار معاينة فقط ولا يُرسل شيئًا قبل التأكيد.",
      current: "الوضع الحالي",
      eligible: "موظفون مؤهلون",
      pending: "بانتظار التوزيع",
      held: "منها معلّقة",
      scope: "النطاق",
      scopeCompany: "كل الشركة",
      scopeTeam: "فريق {name}",
      modes: "الأوضاع",
      currentTag: "الحالي",
      previewUnchanged: "هذا هو الوضع الحالي — لا يوجد ما يُحفظ.",
      previewAuto:
        "عند التأكيد يُحفظ الوضع ويُوزَّع الآن {pending} ليد على {eligible} موظف بالتناوب، ثم كل ليد جديد عند إنشائه.",
      previewAutoRerun:
        "عند التأكيد يُعاد توزيع الليدز غير المملوكة الآن ({pending}). الليدز المملوكة لا يُعاد إسنادها.",
      previewHours:
        "يبقى نشطًا 24 ساعة من التأكيد ثم يتوقف. لا يوجد تشغيل مجدول: التوزيع يتم عند التأكيد وعند إنشاء كل ليد.",
      previewNoEligible: "لا يوجد موظفون مؤهلون — سيُحفظ الوضع لكن لن يُسند أي ليد حتى يتوفر موظف.",
      previewManual: "لا إسناد تلقائي: تُسند الليدز يدويًا. الملكية الحالية لا تتغير.",
      previewPaused:
        "يتوقف أي إسناد تلقائي. الليدز الجديدة تبقى بانتظار التوزيع والملكية الحالية لا تتغير.",
      confirm: "تأكيد",
      confirmRun: "تأكيد وتوزيع الآن",
      running: "جارٍ الحفظ والتوزيع…",
      saving: "جارٍ الحفظ…",
      close: "إغلاق",
      resultAssigned: "أُسند {assigned} ليد. بقي {pending} بانتظار التوزيع ({held} معلّقة).",
      resultNoAuto: "تم الحفظ: {mode} — لا إسناد تلقائي.",
      resultActiveUntil: "نشط حتى {time}.",
      resultFailed: "لم يُسند أي ليد ({code}): {reason}",
    },
  },
} as const;

export default leadOpsAr;
