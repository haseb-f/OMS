/** agentPricing namespace (en) — agent product linking and shipping tariffs (specs/order-operations-r5/spec-2-agent-pricing.md). */
const agentPricingEn = {
  ownership: {
    label: "Ownership",
    COMPANY: "Company",
    AGENT: "Agent",
    agent: "Owner agent",
    agentRequired: "Choose the owner agent.",
    hint: "Agent-owned goods are sold only through that agent. Ownership locks once the product has stock movements, orders, leads or documents.",
  },
  itemType: {
    required: "Choose Product or Service.",
    hint: "Product or service — independent of stock tracking.",
  },
  commissionDraft: {
    title: "Agent commission",
    description: "Saved with the product. New orders use the setting in force on their date.",
    source: "Commission source",
    ratePercent: "Override rate (%)",
    rateRequired: "Enter the override rate (0 to 100).",
    zeroHint: "0% is a valid explicit rate.",
  },
  products: {
    title: "Agent products",
    description:
      "Products sold only through this agent. The commission shown is the one in force today.",
    link: "Link existing product",
    linkTitle: "Link a company product",
    linkDescription:
      "The product moves to this agent. Allowed only while it has no stock movements, orders, leads or documents.",
    linkSearch: "Search by name or SKU",
    linkEmpty: "No company-owned product matches.",
    linkAction: "Link product",
    linked: "Product linked to the agent.",
    newProduct: "New product for this agent",
    unlink: "Unlink",
    unlinkTitle: "Return this product to the company?",
    unlinkDescription:
      "{product} will be company-owned again. Refused once the product has stock movements, orders, leads or documents.",
    unlinked: "Product returned to the company.",
    commissionAction: "Commission",
    commissionTitle: "Item commission — {product}",
    empty: "No products are linked to this agent yet.",
    emptyHint: "Link an existing company product or create a new product for this agent.",
    columns: {
      product: "Product",
      itemType: "Item type",
      status: "Status",
      commission: "Commission",
    },
    itemTypeValue: {
      PRODUCT: "Product",
      SERVICE: "Service",
      UNSET: "Not set",
    },
    commissionSource: {
      OVERRIDE: "Item override",
      AGREEMENT: "Agreement",
    },
    missing: {
      NO_ACTIVE_AGREEMENT: "No active agreement",
      AGENT_ITEM_TYPE_REQUIRED: "Item type not set",
      AGENT_COMMISSION_RATE_MISSING: "No rate for this type",
    },
  },
  emptyCatalog: {
    title: "No products available",
    agent:
      "No products are linked to your agent yet. Ask your agent administrator or the company's agent manager to link products.",
  },
  tariffs: {
    title: "Agent shipping tariffs",
    description:
      "The contractual agent shipping fee by destination, delivery channel and payment type. Customer shipping follows it.",
    channel: "Delivery channel",
    paymentType: "Payment type",
    channels: {
      ANY: "Any",
      CARRIER: "Carrier",
      INTERNAL_COURIER: "Internal courier",
    },
    paymentTypes: {
      ANY: "Any",
      PREPAID: "Prepaid",
      CASH_ON_DELIVERY: "Cash on delivery",
    },
    matrixTitle: "Resolved fee by destination",
    matrixHint:
      "The most specific row wins: city, then channel, then payment type. “Not set” means Shipping cannot choose that delivery method for the destination.",
    destination: "Destination",
    notConfigured: "Not set",
    rowsTitle: "Tariff rows",
    add: "Add tariff",
    saved: "Tariff saved.",
  },
  status: {
    NOT_APPLICABLE: "Not applicable",
    PENDING_METHOD: "Provisional",
    CONFIRMED: "Confirmed",
  },
  provisionalNote: "Provisional — final when Shipping selects the delivery method",
  shippingProvisional: "provisional",
  payablePending: "{merchandise} + shipping (pending)",
  payableEstimate: "Estimate {amount}",
  panel: {
    title: "Shipping pricing",
    customerShipping: "Customer shipping",
    agentFee: "Agent shipping fee (contract)",
    method: "Delivery method",
    methodPending: "Not selected yet",
    carrierCost: "Actual carrier cost",
    carrierEstimate: "Estimate {amount}",
    carrierNone: "Not recorded yet",
    margin: "Shipping margin (company)",
    marginBasis: {
      ACTUAL: "approved carrier cost",
      ESTIMATE: "estimated carrier cost",
    },
    marginUnavailable: "Not comparable yet",
    internalOnly: "Internal only — never shown to the agent.",
  },
  customerTotal: {
    label: "Customer total",
    status: {
      NONE: "—",
      CONFIRMATION_REQUIRED: "Customer confirmation required",
      CONFIRMED: "Customer agreed",
    },
    requiredTitle: "The customer total increased",
    requiredDescription:
      "The confirmed shipping raises the customer total from {previous} to {proposed}. Record the customer's agreement before it is billed; until then {previous} stays the amount to collect.",
    confirm: "Customer agreed to pay {total}",
    confirmTitle: "Record the customer's agreement?",
    confirmDescription:
      "The order total becomes {total} (shipping {shipping}). The change is recorded on the order timeline.",
    confirmed: "Customer agreement recorded — new total {total}.",
    paid: "Paid",
    newPayable: "New payable",
    outstanding: "Outstanding",
  },
  report: {
    portalDescription:
      "Commission per item, shipping retained and what you are entitled to — separate from cash available for payout.",
    portalNote:
      "Entitlement is what you have earned; only the cash position shows what can be paid out now.",
    margin: "Shipping margin",
  },
} as const;

export default agentPricingEn;
