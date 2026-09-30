/** payment-declaration namespace (en) — owned by one implementer to avoid shared-file edit races. */
const paymentDeclarationEn = {
  action: {
    declare: "Declare customer payment",
    update: "Update payment declaration",
  },
  dialog: {
    title: "Customer payment declaration",
    description:
      "Report what the customer told you. This is not Finance verification — Finance confirms and posts separately.",
    question: "Has the customer paid?",
    kinds: {
      UNPAID: "Not paid yet",
      FULL: "Paid in full",
      PARTIAL: "Partially paid",
    },
    fullHint: "Records the remaining order total — no amount to type.",
    partialHint: "Enter only what the customer actually paid.",
    orderTotal: "Validated order total",
    alreadyDeclared: "Already declared",
    remaining: "Remaining to declare",
    willDeclare: "Will be declared",
    amount: "Amount paid",
    method: "Payment method",
    selectMethod: "Select payment method",
    noActiveMethods: "No active payment methods",
    paymentDate: "Actual payment date",
    reference: "Payment reference",
    currency: "Currency",
    submit: "Save declaration",
    notVerifiedNote: "“Customer reported paid” is not “Confirmed & posted by Finance”.",
    errors: {
      amountRequired: "Enter the amount the customer paid.",
      amountExceeds: "The amount cannot exceed the remaining amount to declare.",
      methodRequired: "Select the payment method.",
      dateRequired: "Enter the actual payment date.",
      dateFuture: "The payment date cannot be in the future.",
      nothingRemaining: "The order total is already fully declared.",
      zeroTotal: "Set the agreed line amounts before declaring a payment.",
    },
    success: {
      UNPAID: "Order declared as not paid yet.",
      PAID: "Payment declared — awaiting Finance verification.",
      retry: "This declaration was already saved — nothing was duplicated.",
    },
    failed: "Could not save the payment declaration.",
  },
  sections: {
    declared: "Declared by Sales",
    verification: "Finance verification",
    settlement: "Provider settlement",
  },
  declared: {
    UNPAID: "Customer not paid",
    PARTIALLY_PAID: "Customer reported partial payment",
    PAID: "Customer reported paid",
  },
  declaredShort: {
    UNPAID: "Not declared paid",
    PARTIALLY_PAID: "Partially declared",
    PAID: "Declared paid",
  },
  verification: {
    NONE: "No payment claims yet",
    AWAITING: "Awaiting Finance reconciliation",
    PARTIAL: "Partly confirmed & posted",
    VERIFIED: "Confirmed & posted by Finance",
    DISPUTED: "Disputed by Finance",
    REJECTED: "Rejected by Finance",
  },
  fields: {
    declaredAmount: "Declared amount",
    verifiedAmount: "Confirmed & posted",
    method: "Method",
    origin: "Declared by",
    kind: "Declaration",
    reason: "Reason",
  },
  origin: {
    LEGACY: "Legacy entry",
    SALES_DECLARATION: "Sales",
    FINANCE_DECLARATION: "Finance",
    LEAD_CONVERSION: "Lead conversion",
  },
  kind: {
    FULL: "Paid in full",
    PARTIAL: "Partial",
  },
  discrepancy: {
    title: "Payment discrepancy",
    description:
      "Finance disputed or rejected a payment after fulfillment started. Resolve it with Finance — the shipment history was not changed.",
  },
  gate: {
    notReadyHint:
      "Becomes ready for shipping once the customer payment is declared paid in full — Finance verification is not required. A partial declaration is not enough.",
    pickupHint:
      "Ready for pickup and collection can be recorded once the customer payment is declared paid in full (or the order is cash on delivery).",
    readyDeclared: "Payment declared by Sales — Finance verification still pending.",
  },
  pickup: {
    title: "Pickup",
    status: "Pickup status",
    actions: {
      READY_FOR_PICKUP: "Mark ready for pickup",
      COLLECTED: "Record collection",
      CANCELLED: "Cancel pickup",
    },
    codes: {
      AWAITING_PREPARATION: "Awaiting preparation",
      READY_FOR_PICKUP: "Ready for pickup",
      COLLECTED: "Collected",
      CANCELLED: "Cancelled",
      RETURNED: "Returned",
    },
    confirm: {
      COLLECTED: {
        title: "Record collection?",
        description: "Confirms the customer received the order. This cannot be undone.",
      },
      CANCELLED: {
        title: "Cancel this pickup?",
        description: "The pickup is cancelled. This cannot be undone.",
      },
    },
    success: "Pickup status updated.",
    failed: "Could not update the pickup status.",
  },
  filter: {
    declaredStatus: "Customer payment (declared)",
  },
  review: {
    method: "Method",
    kind: "Declaration",
    origin: "Declared by",
    debitAccount: "Account to be debited",
    debitAccountHint: "From the payment method — read only",
    legacyReceivingAccount: "Receiving account (legacy)",
    noMethodAccount: "Payment method has no account",
    requiresReconciliation: "Statement reconciliation",
    reconcileInWorkspace: "Reconcile in workspace",
    reconcileHint:
      "This method requires statement reconciliation — confirm it by matching the provider transaction in its reconciliation workspace.",
    dispute: "Dispute",
    disputeTitle: "Dispute this declaration",
    disputeDescription:
      "The claim stops counting as declared. If the order was already shipped or collected it is flagged for action; shipments are never changed.",
    disputeReason: "Dispute reason",
    disputeReasonRequired: "Enter the reason for the dispute.",
    disputed: "Payment disputed.",
    disputeFailed: "Could not dispute the payment.",
  },
  method: {
    requiresReconciliation: "Requires reconciliation",
    isActive: "Active",
    yes: "Yes",
    no: "No",
  },
} as const;

export default paymentDeclarationEn;
