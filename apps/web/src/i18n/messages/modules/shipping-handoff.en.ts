/** shippingHandoff namespace (en) — R6 SHIP: Sales → internal Shipping queue handoff feedback. */
const shippingHandoffEn = {
  sentToShipping: "Sent to Shipping — ready for shipping.",
  inQueue: "In the Shipping queue — ready for shipping.",
  openInQueue: "Open in Shipping queue",
  blocker: {
    PAYMENT_REQUIRED:
      "Not sent to Shipping yet — prepaid order awaiting a full payment declaration (or Finance verification).",
    NOT_SHIPPABLE: "Nothing to ship — digital-only order.",
    ORDER_CANCELLED: "Cancelled — not in the Shipping queue.",
    ORDER_CLOSED: "Fulfillment is already final — not in the Shipping queue.",
    ORDER_ARCHIVED: "Archived — not in the Shipping queue.",
    PICKUP: "Pickup order — prepared for collection, never shipped.",
  },
} as const;

export default shippingHandoffEn;
