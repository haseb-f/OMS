/** storeOrderMoney namespace (en) — R15 W5b collections, returns, refunds. */
const storeOrderMoneyEn = {
  panel: {
    title: "Collection",
    loadFailed: "Could not load the order's money position.",
    orderGroup: "What the customer owes",
    moneyGroup: "Money received",
    documents: "Documents",
    noDocuments: "No payments, invoices, returns or refunds yet.",
    figures: {
      payable: "Order total",
      invoiced: "Invoiced (delivered)",
      credited: "Credited (returns)",
      balanceDue: "Balance due",
      declared: "Declared — not verified",
      expectedFromCarrier: "Expected from the carrier",
      collected: "Collected (verified)",
      withCarrier: "Held by the carrier",
      awaitingSettlement: "Awaiting provider settlement",
      inBank: "In the bank",
      refunded: "Refunded",
      refundDue: "Refund due",
    },
    columns: {
      document: "Document",
      details: "Details",
      amount: "Amount",
      actions: "Actions",
    },
    shipment: "Shipment #{number}",
    tracking: "Tracking {tracking}",
    returnRequested: "Requested",
    returnReceived: "Received",
    againstReturns: "{amount} against credit notes",
    advance: "Order advance",
    carrierCod: "Carrier COD",
    receipt: "Receipt",
    reversedReason: "Reversed: {reason}",
    cancelled: "Cancelled order — only money for goods delivered and kept is owed.",
  },
  returnNotice: {
    title: "Store order return",
  },
  cod: {
    tracked:
      "Cash on delivery is collected by {carrier} ({method}): it counts as collected once the carrier's COD report is matched, and is in the bank once the carrier's remittance is settled.",
    notTracked:
      "COD collection is not tracked for {carrier} — record the payment when the carrier pays.",
  },
  refundPending: {
    title: "Refund pending: {amount}",
    body: "A credit note does not refund the customer. Return the money through the payment gateway or the bank, then record the refund here.",
  },
  actions: {
    requestReturn: "Return",
    receive: "Receive & inspect",
    recordRefund: "Record refund",
    reverse: "Reverse",
  },
  returnDialog: {
    title: "Return — order {order}",
    description:
      "Request a return of delivered goods. Nothing moves in stock and nothing is posted until the goods are received and inspected.",
    reason: "Reason",
    reasonRequired: "Enter why the customer returns the goods.",
    invoice: "Invoice",
    product: "Product",
    delivered: "Delivered",
    alreadyReturned: "Returned",
    quantity: "Return",
    noLines: "Enter a quantity on at least one line.",
    tooMany: "At most {max}.",
    nothingReturnable: "Nothing delivered remains returnable on this order.",
    submit: "Request return",
    requested: "Return {numbers} requested.",
  },
  receiveDialog: {
    title: "Receive & inspect — {number}",
    description:
      "Record the condition of each returned line. Saleable goods go back to stock, damaged goods to the damaged-goods warehouse; the credit note is posted on receipt.",
    reason: "Customer's reason: {reason}",
    product: "Product",
    quantity: "Qty",
    condition: "Condition",
    saleable: "Saleable",
    damaged: "Damaged",
    warehouse: "Warehouse",
    saleableDefault: "Default: the line's stock warehouse",
    damagedDefault: "Default: the damaged-goods warehouse",
    damagedNote:
      "Damaged goods still come back into inventory value in the damaged-goods warehouse; writing them off is a separate inventory decision.",
    submit: "Receive & post credit note",
    received: "Return {number} received — credit note posted.",
  },
  refundDialog: {
    title: "Record refund — order {order}",
    collected: "Collected",
    netInvoiced: "Owed after credit notes",
    refunded: "Already refunded",
    refundDue: "Refund due",
    customerCredit: "Customer credit (ledger)",
    refundable: "Can be refunded now",
    gatewayNotice:
      "No payment gateway is connected: return the money through the gateway or the bank first, then record it here with its reference.",
    split: "Credit notes are refunded first (oldest first), then the order's advance.",
    recorded: "Refund {number} recorded.",
  },
  reverseDialog: {
    title: "Reverse payment {number}",
    description:
      "Only for a payment verified in error. Its receipt is reversed by a reversing journal entry, the payment is marked Reversed with your reason, and the order's balance is recomputed. Nothing is deleted.",
    reason: "Reason",
    reasonRequired: "A reason is required.",
    submit: "Reverse payment",
    reversed: "Payment {number} reversed.",
    blocked: {
      SETTLED: "Included in a posted settlement — reverse the settlement first.",
      MATCHED: "Matched to a provider statement — correct the match in Payment reconciliation.",
      AGENT_RECEIVED: "Received by the agent — handled in Agent collections.",
    },
  },
  carrier: {
    codMethod: "COD collection method",
    codMethodHelp:
      "Cash this carrier collects on delivery. Delivery records the expected amount on the order, the carrier's COD report is matched as this method's statement, and its remittance is settled to the bank. Only reconciled methods with a clearing account are offered; leave empty to record COD payments manually.",
    notTracked: "Not tracked",
  },
} as const;

export default storeOrderMoneyEn;
