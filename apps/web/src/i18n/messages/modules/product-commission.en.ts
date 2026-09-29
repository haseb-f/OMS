/** productCommission namespace (en) — item commission setting of an agent-owned product (commission-policy.md A4). */
const productCommissionEn = {
  title: "Commission",
  description:
    "The agent commission rate applied to this item. New orders use the setting in force on their date; existing orders keep their rate.",
  ownership: "Ownership",
  ownershipValue: {
    COMPANY: "Company-owned",
    AGENT: "Agent-owned",
  },
  owner: "Owning agent",
  class: "Commission class",
  classValue: {
    PRODUCT: "Product",
    SERVICE: "Service / course",
    UNSET: "Not classified — set the item type",
  },
  classHint: "Set in the item's “Item type” field (independent of stock tracking).",
  itemType: {
    label: "Item type",
    PRODUCT: "Product (stocked or not)",
    SERVICE: "Service / course",
    UNSET: "Not classified — needs review",
    hint: "Decides the agent commission rate (product or service). Stock tracking is a separate setting.",
  },
  source: "Commission source",
  sourceValue: {
    INHERIT: "Inherit agent agreement",
    OVERRIDE: "Item override",
  },
  currentRate: "Current rate",
  loadFailed: "Could not load the commission setting.",
  form: {
    title: "Change setting",
    ratePercent: "Override rate (%)",
    zeroHint: "0% is a valid explicit rate.",
    effectiveFrom: "Effective from",
    effectiveFromHint:
      "Must be after the start of every earlier setting — history is never rewritten.",
    reason: "Reason",
    save: "Save commission setting",
    saved: "Commission setting saved.",
    rateRequired: "Enter the override rate (0 to 100).",
    effectiveFromRequired: "Choose the effective date.",
  },
  history: {
    title: "Override history",
    rate: "Rate",
    from: "From",
    to: "To",
    reason: "Reason",
    openEnded: "Open",
    empty: "No item overrides — the agent agreement rate applies.",
  },
} as const;

export default productCommissionEn;
