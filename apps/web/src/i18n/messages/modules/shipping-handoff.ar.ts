/** shippingHandoff namespace (ar) — R6 SHIP: Sales → internal Shipping queue handoff feedback. */
const shippingHandoffAr = {
  sentToShipping: "تم الإرسال إلى الشحن — جاهز للشحن.",
  inQueue: "في قائمة الشحن — جاهز للشحن.",
  openInQueue: "فتح في قائمة الشحن",
  blocker: {
    PAYMENT_REQUIRED:
      "لم يُرسل إلى الشحن بعد — طلب مدفوع مسبقًا بانتظار إفادة دفع كامل (أو تحقق المالية).",
    NOT_SHIPPABLE: "لا يوجد ما يُشحن — طلب رقمي بالكامل.",
    ORDER_CANCELLED: "ملغي — ليس في قائمة الشحن.",
    ORDER_CLOSED: "التنفيذ مكتمل نهائيًا — ليس في قائمة الشحن.",
    ORDER_ARCHIVED: "مؤرشف — ليس في قائمة الشحن.",
    PICKUP: "طلب استلام — يُجهَّز للاستلام ولا يُشحن.",
  },
} as const;

export default shippingHandoffAr;
