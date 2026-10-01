/** paymentVocabulary namespace (ar) — المصطلحات الموحّدة للمدفوعات (الجولة 5، المواصفة 3A). */
const paymentVocabularyAr = {
  term: {
    DECLARED: {
      label: "مُبلغ عنه · بانتظار المراجعة",
      description: "أبلغ المبيعات أو الوكيل عن دفعة من العميل — لم يُتحقق من شيء بعد.",
    },
    STATEMENT_LINE: {
      label: "حركة كشف · غير مطابقة",
      description: "حركة مستوردة من كشف المزوّد أو البنك لم تُخصص لأي إبلاغ بعد.",
    },
    LINE_ALLOCATED: {
      label: "حركة كشف · مخصصة",
      description: "الحركة مخصصة بالكامل لإبلاغات الدفع.",
    },
    MATCHED: {
      label: "مطابق · غير مُرحّل",
      description: "طابقته المالية بحركة كشف أو بسجل دفع، ولم يُرحّل أي سند قبض بعد.",
    },
    CONFIRMED: {
      label: "مؤكد ومُرحّل",
      description: "رحّلت المالية سند قبض العميل إلى حساب التسوية أو النقدية الخاص بالطريقة.",
    },
    AWAITING_SETTLEMENT: {
      label: "بانتظار التسوية",
      description: "مُرحّل إلى حساب تسوية المزوّد، ولم يحوّله المزوّد إلى البنك بعد.",
    },
    PARTIALLY_SETTLED: {
      label: "مُسوّى جزئيًا",
      description: "وصل جزء من المبلغ إلى البنك، والباقي ما زال لدى المزوّد.",
    },
    SETTLED: {
      label: "مُسوّى للبنك",
      description: "حوّل المزوّد المبلغ المُسوّى إلى البنك.",
    },
    DISPUTED: {
      label: "متنازع عليه",
      description: "اعترضت المالية على الإبلاغ مع ذكر السبب، ولم يعد يُحتسب كمُبلغ عنه.",
    },
    REJECTED: {
      label: "مرفوض",
      description: "رفضت المالية الإبلاغ مع ذكر السبب، ولم يُرحّل شيء.",
    },
    EXCEPTION: {
      label: "استثناء",
      description: "تغيّر سطر في الكشف أو فشل بعد الاستيراد ويحتاج إلى قرار.",
    },
    IGNORED: {
      label: "متجاهلة",
      description: "استبعدت المالية هذا السطر؛ لا يُقترح ولا يُطابق.",
    },
  },
  stageOf: "المرحلة {stage} من 5",
  strip: {
    label: "مراحل المدفوعات",
    showAll: "عرض الكل",
    filtered: "مُصفّى",
    nothing: "لا يوجد ما ينتظر",
    restricted: "يتطلب صلاحية المطابقة",
    openWorkspace: "فتح",
    methods: "{count} طرق",
    declared: {
      title: "إبلاغات بانتظار المراجعة",
      description: "يعرض الإبلاغات التي لم تتخذ المالية قرارًا بشأنها بعد.",
    },
    unmatchedLines: {
      title: "حركات كشف غير مطابقة",
      description: "حركات مزوّد بلا إبلاغ بعد — يفتح المطابقة.",
    },
    exceptions: {
      title: "استثناءات",
      description: "أسطر كشف تغيّرت أو فشلت وتحتاج إلى قرار — يفتح الاستثناءات.",
    },
    awaitingConfirmation: {
      title: "بانتظار التأكيد",
      description: "مطابقة غير مُرحّلة — أكّدها ورحّلها من هذه القائمة.",
    },
    partiallyAllocated: {
      title: "مخصصة جزئيًا",
      description: "الكشف يغطي جزءًا من الإبلاغ — خصص الباقي في مساحة المطابقة.",
    },
    awaitingSettlement: {
      title: "بانتظار التسوية",
      description: "مُرحّلة إلى حساب التسوية — سوِّها للبنك عند تحويل المزوّد.",
    },
  },
  action: {
    confirmPost: "تأكيد وترحيل",
    confirmMatchPost: "تأكيد المطابقة والترحيل",
    match: "مطابقة…",
    review: "مراجعة",
    rejectDeclaration: "رفض الإبلاغ",
    unmatch: "إلغاء المطابقة",
    reversePosting: "عكس الترحيل",
    refundCustomer: "استرداد للعميل",
    dispute: "اعتراض",
    openWorkspace: "فتح المطابقة",
    acceptStrong: "قبول الاقتراحات القوية",
  },
  reason: {
    settled: "مُسوّاة — اعكس التسوية أولًا",
    currencyDiffers: "العملة تختلف عن عملة الطلب",
    reconciledMethod: "تُؤكد هذه الطريقة بمطابقة كشف المزوّد",
    alreadyPosted: "مؤكدة ومُرحّلة بالفعل",
    notOpen: "يمكن اتخاذ القرار فقط لإبلاغ بانتظار المراجعة أو مطابق",
    activeMatches: "لها مطابقات مع الكشف — ألغِ المطابقة أولًا",
    noPermission: "لا تملك صلاحية هذا الإجراء",
    missingPrice: "حدّد المبالغ المتفق عليها للطلب أولًا",
    noOrder: "غير مرتبطة بطلب",
    notPosted: "لم يُرحّل شيء بعد — لا يوجد ما يُسترد",
    noLine: "اختر حركة من الكشف أولًا",
    noDebitAccount: "طريقة الدفع بلا حساب ترحيل",
    agentCollection: "استلمها الوكيل — تُراجع في تحصيلات الوكلاء",
  },
  effect: {
    title: "ماذا سيحدث",
    confirmPost:
      "يرحّل سند قبض للعميل بمبلغ {amount} — مدين {account} / دائن ذمم العميل — للطلب {order}.",
    matchPost:
      "يخصص {amount} من الحركة {reference} للإبلاغ {payment} ويرحّل سند قبض — مدين {account} / دائن ذمم العميل — للطلب {order}.",
    matchPartial:
      "يخصص {amount} من الحركة {reference} للإبلاغ {payment}. لا يُرحّل شيء حتى يُخصص الإبلاغ بالكامل (المتبقي {remaining}).",
    reject:
      "يرفض الإبلاغ {payment} ({amount}، الطلب {order}) مع السبب. لا يُرحّل شيء ويُعاد احتساب حالة الدفع المُبلغ عنها للطلب.",
    dispute:
      "يسجّل اعتراضًا على الإبلاغ {payment} ({amount}، الطلب {order}) مع السبب. لا تتغير الشحنات أبدًا.",
    unmatch:
      "يحرر {amount} من الحركة {reference} من الإبلاغ {payment}. لم تُرحّل هذه المطابقة شيئًا، فلا يتغير أي قيد.",
    reversePosting:
      "يلغي سند القبض {receipt} بقيد عكسي للقيد {journal}، ويحرر {amount} من الحركة {reference}، ويعيد {payment} إلى المراجعة.",
    bulkConfirm:
      "يرحّل سند قبض وقيدًا لكل إبلاغ ({totals}) على حساب طريقته. يُتحقق من كل إبلاغ على حدة، وتُعرض الإبلاغات المرفوضة مع سببها.",
    bulkReject:
      "يرفض كل إبلاغ بالسبب المشترك. لا يُرحّل شيء، وتُرفض الإبلاغات المُرحّلة أو المُسوّاة أو المطابقة كلٌّ على حدة.",
    bulkAccept:
      "يؤكد ويرحّل كل اقتراح قوي وواضح ({totals}) على حساب تسوية الطريقة. تبقى الحركات الأخرى للمراجعة الصريحة.",
    refund:
      "الاسترداد مسار منفصل: سجّل استردادًا للعميل مقابل السند المُرحّل — يبقى الإبلاغ وترحيله دون تغيير.",
  },
  panel: {
    title: "مراجعة الدفعة {payment}",
    loading: "جارٍ تحميل الدفعة…",
    declaration: "الإبلاغ",
    statement: "حركة الكشف",
    matchedTransactions: "الحركات المطابقة",
    suggestions: "حركات الكشف المرتبة",
    noSuggestions: "لا توجد حركة غير مطابقة لهذه الطريقة والعملة تناسب هذا الإبلاغ.",
    ambiguous: "عدة حركات تطابق بالقدر نفسه — اختر الحركة الصحيحة صراحةً.",
    notReconciled: "لا يوجد كشف مزوّد لهذه الطريقة — تؤكدها المالية من مراجعة المدفوعات.",
    restricted: "تحتاج صلاحية المطابقة لعرض حركات الكشف.",
    evidence: "الأدلة",
    discrepancy: "الفروقات",
    noDiscrepancy: "لا توجد فروقات",
    amountDifference: "فرق في المبلغ {amount}",
    currencyMismatch: "العملة {line} ≠ عملة الإبلاغ {claim}",
    dateGap: "{days} يوم بين الإبلاغ والحركة",
    attachments: "مرفقات الإثبات",
    noAttachments: "لا توجد مرفقات",
    technical: "تفاصيل تقنية",
    select: "اختيار",
    selected: "مختارة",
    reasonLabel: "السبب",
    reasonRequired: "السبب مطلوب.",
    fields: {
      order: "الطلب",
      customer: "العميل",
      amount: "المبلغ المُبلغ عنه",
      date: "تاريخ الإبلاغ",
      method: "الطريقة",
      reference: "المرجع",
      debitAccount: "الحساب المدين",
      receipt: "سند القبض",
      journal: "القيد",
      transactionDate: "تاريخ الحركة",
      payer: "الدافع",
      source: "مصدر الاستيراد",
      unallocated: "غير مخصص",
      paymentId: "معرّف الدفعة",
      lineId: "معرّف السطر",
      importId: "معرّف الاستيراد",
      dedupeKey: "مفتاح منع التكرار",
      rowHash: "بصمة السطر",
      row: "سطر المصدر",
    },
    done: {
      confirmed: "تم التأكيد والترحيل — السند {receipt}، القيد {journal}.",
      matched: "تمت المطابقة — {posted}",
      matchedPosted: "رُحّل السند.",
      matchedPartial: "يبقى الإبلاغ مطابقًا · غير مُرحّل حتى يُخصص بالكامل.",
      rejected: "رُفض الإبلاغ {payment}.",
      disputed: "سُجّل اعتراض على الإبلاغ {payment}.",
      unmatched: "أُلغيت المطابقة — لم يُرحّل شيء ولم يُعكس شيء.",
      reversed: "عُكس الترحيل — أُلغي السند {receipt}.",
    },
  },
  blocked: {
    PROVIDER_STATUS_FAILED: "حالة المزوّد «{status}» ليست دفعة ناجحة — لا يمكن مطابقتها.",
    LINE_NOT_UNMATCHED: "لم تعد هذه الحركة غير مطابقة — الاقتراحات للحركات غير المطابقة فقط.",
    LINE_FULLY_ALLOCATED: "هذه الحركة مخصصة بالكامل.",
  },
  bulk: {
    progress: "جارٍ معالجة {done} من {total}…",
    requestFailed: "فشل طلب هذه المجموعة — لا يُعرف أن شيئًا تغيّر فيها: {message}",
    selectedEligible: "يمكن معالجة {eligible} من {selected} محددة.",
    noneEligible: "لا يمكن معالجة أي من الدفعات المحددة بهذه الطريقة.",
    confirmTitle: "تأكيد وترحيل {count} إبلاغ؟",
    rejectTitle: "رفض {count} إبلاغ؟",
    acceptTitle: "قبول {count} اقتراح قوي؟",
    acceptNone: "لا توجد حركة غير مطابقة لها اقتراح قوي وواضح.",
    planning: "جارٍ فحص الاقتراحات…",
    sharedReason: "السبب (يُحفظ على كل إبلاغ مرفوض)",
    resultTitle: "نتيجة المعالجة الجماعية",
    succeeded: "تم {count}",
    failed: "رُفض {count}",
    failedList: "المرفوضة — لكل منها سببه",
    allDone: "تمت معالجة الكل ({count}).",
    partial: "تم {succeeded} ورُفض {failed} — راجع الأسباب.",
    skipped: "{count} عنصر محدد غير مؤهل ولن يُرسل.",
  },
} as const;

export default paymentVocabularyAr;
