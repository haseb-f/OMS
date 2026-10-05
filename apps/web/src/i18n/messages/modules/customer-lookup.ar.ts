/** customerLookup namespace (ar) — R7 advanced customer lookup (`customers.lookup_advanced`). */
const customerLookupAr = {
  trigger: "بحث متقدم عن عميل",
  title: "بحث متقدم عن عميل",
  description:
    "تحقق مما إذا كان العميل موجودًا بالفعل ولمن يتبع. النتائج محدودة ومخفية جزئيًا ومسجّلة — ولا تمنحك هذه الأداة صلاحية الوصول إلى سجلات العميل.",
  queryLabel: "رقم الهاتف أو اسم العميل أو رقم الطلب",
  placeholder: "الهاتف بأي صيغة، أو الاسم الأول والأخير، أو STO-2026-000123",
  search: "بحث",
  hintMinimum: "أدخل رقم هاتف من 7 أرقام على الأقل، أو الاسم الأول والأخير للعميل، أو رقم الطلب.",
  notice: "يُسجَّل كل بحث، ويُحدَّد عدد مرات البحث المتكرر. البيانات مخفية جزئيًا عمدًا.",
  loading: "جارٍ البحث…",
  idle: "ابحث برقم الهاتف أو الاسم أو رقم الطلب لمعرفة ما إذا كان العميل موجودًا.",
  empty: "لم يتم العثور على عميل مطابق.",
  error: "فشل البحث. حاول مرة أخرى.",
  forbidden: "لا تملك صلاحية البحث المتقدم عن العملاء. اطلب من المسؤول منحك إياها.",
  searchAll: "البحث في كل العملاء",
  searchAllHint:
    "لم تجده في قائمتك؟ يستطيع البحث المتقدم إيجاد عميل يتبع موظفًا آخر (للقراءة فقط).",
  rateLimited: "عدد مرات البحث كبير. يرجى الانتظار بضع دقائق قبل البحث مرة أخرى.",
  tooShort: "نص البحث قصير جدًا.",
  capped: "توجد نتائج أخرى. ضيّق البحث للوصول إليها.",
  remaining: "المتبقي {count} عملية بحث في هذه الفترة",
  found: "تم العثور على {count} عميل مطابق.",
  columns: {
    customer: "العميل",
    reference: "آخر سجل",
    status: "الحالة",
    assignment: "الإسناد",
    action: "",
  },
  kind: {
    CUSTOMER: "عميل",
    LEAD: "عميل محتمل",
  },
  referenceType: {
    ORDER: "طلب",
    LEAD: "عميل محتمل",
  },
  noReference: "لا يوجد طلب أو عميل محتمل بعد",
  status: {
    IN_PROGRESS: "قيد التنفيذ",
    COMPLETED: "مكتمل",
    CANCELLED: "ملغى",
    RETURNED: "مرتجع",
    OPEN: "مفتوح",
    CONVERTED: "تم تحويله",
    CLOSED: "مغلق",
  },
  notAssignedToYou: "غير مسند إليك",
  assignedToYou: "مسند إليك",
  previousOrders: "الطلبات السابقة",
  moreOrders: "+{count} أخرى",
  open: "فتح",
  noAccess: "غير متاح لك",
} as const;

export default customerLookupAr;
