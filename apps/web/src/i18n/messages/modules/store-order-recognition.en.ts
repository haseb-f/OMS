/** storeOrderRecognition namespace (en) — R14 W3: revenue, stock and cost recognised at delivery. */
const storeOrderRecognitionEn = {
  label: "Recognition",
  status: {
    NOT_DUE: "Not due",
    RESERVED: "Stock reserved",
    RECOGNIZED: "Recognised",
    FAILED: "Recognition failed",
    RETURN_PENDING: "Return pending",
  },
  failed: {
    title: "The delivery was saved, but the sale could not be recognised",
    description:
      "No invoice, stock issue or cost of goods sold was posted for this delivered order. Fix the cause below, then retry.",
    lastAttempt: "Last attempt: {date}",
  },
  reservationFailed: {
    title: "Stock could not be reserved for this shipment",
    description:
      "The shipment status was saved. Fix the cause below — recognition will be attempted again at delivery.",
  },
  returnPending: {
    title: "Returned after delivery",
    description:
      "Post a sales return against invoice {invoice} once the goods are inspected — it restocks the items and reverses the cost.",
  },
  retry: "Retry recognition",
  retrying: "Retrying…",
  retried: "Sale recognised — invoice issued, stock and cost posted.",
} as const;

export default storeOrderRecognitionEn;
