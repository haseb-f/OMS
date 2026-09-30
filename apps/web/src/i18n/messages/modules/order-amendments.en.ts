/** orderAmendments namespace (en) — Round 5 Spec 1A order amendments + Spec 1C compact order detail. */
const orderAmendmentsEn = {
  action: "Amend order",
  title: "Amend order {number}",
  description: "Change the order until delivery. Every amendment is audited with its reason.",
  steps: {
    edit: "Changes",
    preview: "Impact review",
  },
  sections: {
    customer: "Customer",
    items: "Items",
    payment: "Currency & payment",
    fulfillment: "Fulfillment & destination",
    reason: "Reason",
  },
  fields: {
    switchCustomer: "Customer",
    switchCustomerHint: "Choose another existing customer, or correct this customer's details below.",
    name: "Customer name",
    phone: "Phone",
    email: "Email",
    identityHint: "Correcting the customer's name, phone or email changes the customer record.",
    identityLocked: "Correcting the customer's identity needs the Customers edit permission.",
    product: "Product",
    quantity: "Qty",
    agreedAmount: "Agreed amount",
    addLine: "Add line",
    removeLine: "Remove line",
    currency: "Currency",
    currencyAgentHint: "Agent orders use the agreement currency.",
    paymentType: "Payment arrangement",
    pricingMode: "Pricing",
    agreedTotal: "Agreed total (shipping included)",
    fulfillmentMethod: "Fulfillment method",
    country: "Country",
    city: "City",
    address: "Address",
    reason: "Why is the order being amended?",
    reasonPlaceholder: "e.g. Customer asked for a second unit",
    reasonRequired: "Enter the reason (at least 3 characters).",
  },
  lineRequired: "Every line needs a product and a quantity of at least 1.",
  amountRequired: "Enter the agreed amount of every line.",
  noChanges: "Nothing changed yet — edit at least one field.",
  review: "Review impact",
  back: "Back to changes",
  commit: "Save amendment",
  previewing: "Checking impact…",
  saving: "Saving…",
  totals: "Order total {previous} → {next}",
  totalsUnchanged: "Order total stays {next}",
  blockingTitle: "Cannot be saved yet",
  acknowledgeTitle: "Please confirm",
  infoTitle: "What will change",
  acknowledgeHint: "Tick every confirmation to save.",
  success: "Order amended (version {version}).",
  invoiceRegenerated: "New invoice {number} issued.",
  conflict: {
    title: "The order was changed meanwhile",
    description: "This order was changed by {user} at {time}. Reload to see the latest version.",
    someone: "another user",
    reload: "Reload order",
  },
  impact: {
    ORDER_LOCKED_AFTER_DELIVERY:
      "Order {orderNumber} is delivered, collected, returned, cancelled or archived — use the return, refund or adjustment workflows.",
    ORDER_IN_TRANSIT:
      "The shipment is on its way — items, quantities, address and fulfillment method cannot change. Use a return or reshipment; prices and customer contact can still change.",
    LABEL_REISSUE_REQUIRED: "Label {tracking} must be cancelled and reissued.",
    TOTALS_CHANGED: "Order total {previous} → {next} {currency}.",
    ORDER_TOTAL_ZERO: "The order total must be greater than 0.00.",
    DECLARATION_REEVALUATED:
      "Declarations stay unchanged ({declared}); the declared status is re-evaluated against the new total {next}.",
    PAYMENT_STATUS_REEVALUATED:
      "Confirmed payments ({paid}) stay unchanged; the payment status is re-evaluated against {next} {currency}.",
    PAYMENT_OVERPAID_REFUND:
      "Confirmed payments {paid} exceed the new total {next} {currency}: the order becomes overpaid by {excess}. Refund the excess through Finance → Customer refunds.",
    CURRENCY_LOCKED_BY_PAYMENT:
      "Reverse or refund payment {payment} ({amount} {currency}) first — a posted or matched payment keeps the order currency.",
    CURRENCY_DECLARATIONS_REVIEW:
      "{count} payment declaration(s) stay in {currency}; the order is flagged for Finance review.",
    INVOICE_DRAFT_CANCELLED:
      "Draft invoice {invoice} will be cancelled and a new invoice issued from the amended order.",
    INVOICE_POSTED:
      "Sales invoice {invoice} is posted and never changed. Correct it with a sales return referencing {invoice}, and record the difference as a separate order.",
    CUSTOMER_PERMISSION_REQUIRED:
      "Correcting the customer's name, phone or email needs the Customers edit permission.",
    CUSTOMER_OUT_OF_SCOPE:
      "This customer cannot be attached to a company order — choose a company customer.",
    CUSTOMER_PHONE_IN_USE:
      "This phone belongs to another customer ({customer}) — switch the order to that customer instead.",
    CUSTOMER_MASTER_SHARED:
      "The customer record is shared by {count} other order(s) — the correction applies everywhere.",
    CUSTOMER_DUPLICATE_REVIEW:
      "The new mobile matches a customer outside your scope — the order keeps its own customer and is flagged for duplicate review.",
    CUSTOMER_RELINKED: "The new mobile belongs to the existing customer {customer} — the order is linked to that customer.",
    LINE_HAS_ALLOCATIONS:
      "A removed or changed line is allocated to an investment opportunity — reverse that allocation first.",
    AGENT_COMMISSION_EARNED:
      "The agent commission of this order is already earned — use the agent return / adjustment workflow.",
    AGENT_STOCK_ISSUED:
      "The agent stock of this order was already issued — use the agent return / adjustment workflow.",
    AGENT_FINANCIAL_RECORDS:
      "This order has a posted payment or invoice — ask the company's agent manager to amend it.",
    AGENT_SHIPPING_TARIFF_MISSING:
      "The agreement has no shipping tariff for the assigned delivery method ({deliveryChannel}) × {paymentType} × the new destination — add it to the agreement or ask Shipping to choose another method first.",
    AGENT_REQUOTED:
      "Re-quoted under agreement {agreement}: payable {previous} → {next}. The commission snapshot is replaced; the previous one stays in the history.",
    AGENT_SHIPPING_REPRICED:
      "Agent shipping fee {previous} ({previousStatus}) → {next} ({nextStatus}).",
  },
  nextAction: {
    RESOLVE_DUPLICATE: "Resolve duplicate review",
    CONFIRM_CUSTOMER_TOTAL: "Confirm customer total",
    SET_AMOUNTS: "Set agreed amounts",
    REISSUE_LABEL: "Reissue label",
    DECLARE_PAYMENT: "Declare payment",
    AWAITING_FINANCE: "Awaiting Finance review",
    ASSIGN_SHIPPING: "Assign shipping",
    MARK_HANDED_OVER: "Mark handed over",
    UPDATE_SHIPMENT: "Update shipment",
    MARK_READY_FOR_PICKUP: "Mark ready for pickup",
    MARK_COLLECTED: "Mark collected",
    GENERATE_INVOICE: "Generate invoice",
    handedOverTitle: "Mark the parcel handed over to the carrier?",
    handedOverDescription: "The shipment moves to Shipped. Items and address cannot be amended afterwards.",
    handedOver: "Shipment marked as shipped.",
  },
  detail: {
    card: "Order",
    payment: "Payment",
    fulfillment: "Fulfillment",
    destination: "Destination",
    merchandise: "Merchandise",
    discount: "Discount",
    shipping: "Shipping",
    service: "Service charge",
    payable: "Payable",
    paid: "Confirmed paid",
    declared: "Declared",
    outstanding: "Outstanding",
    shippingState: {
      PROVISIONAL: "Provisional",
      CONFIRMED: "Confirmed",
      PENDING_CUSTOMER: "Customer confirmation pending",
    },
    duplicateReview: "Duplicate review pending",
    labelReissue: "Label {tracking} must be cancelled and reissued — the order was amended after it was issued.",
    sections: {
      payments: "Payments & financial history",
      shipments: "Shipment history",
      history: "Amendments & activity",
      technical: "Technical details",
    },
    summary: {
      payments: "{count} payment record(s)",
      shipments: "{count} attempt(s)",
      history: "{count} amendment(s)",
    },
    amendments: {
      title: "Amendments",
      empty: "No amendments yet.",
      version: "Version {version}",
      by: "{actor} · {date}",
      agent: "Agent",
      lineAdded: "Added {product} × {quantity} ({amount})",
      lineRemoved: "Removed {product} × {quantity}",
      lineChanged: "{product}: {oldQuantity} × {oldAmount} → {newQuantity} × {newAmount}",
      field: "{field}: {old} → {new}",
      fields: {
        currency: "Currency",
        paymentType: "Payment",
        fulfillmentMethod: "Fulfillment",
        pricingMode: "Pricing",
        destination: "Destination",
        customer: "Customer",
        total: "Total",
      },
    },
    technical: {
      orderId: "Order ID",
      version: "Version",
      snapshot: "Agent terms snapshot",
    },
  },
} as const;

export default orderAmendmentsEn;
