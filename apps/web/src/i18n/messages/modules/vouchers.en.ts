/** vouchers namespace (en) — receipt / payment voucher card and invoice settlement history (Round 22). */
const vouchersEn = {
  purposes: {
    SETTLE_INVOICES_IN: "Collect customer invoices",
    ADVANCE_IN: "Customer advance (unapplied)",
    OTHER_IN: "Other receipt (counter-account)",
    TRANSFER_IN: "Internal transfer between accounts",
    SETTLE_INVOICES_OUT: "Pay supplier invoices",
    ADVANCE_OUT: "Supplier advance (unapplied)",
    EXPENSE_OUT: "Direct expense",
    OTHER_OUT: "Other payment (counter-account)",
    TRANSFER_OUT: "Internal transfer between accounts",
  },
  purposeHints: {
    SETTLE_INVOICES_IN:
      "The amount settles the customer's open invoices; any surplus stays an advance on their account.",
    ADVANCE_IN:
      "Recorded on the customer's account without settling an invoice — it can be allocated later.",
    OTHER_IN: "Other income, capital or a loan — credited to the counter-account you choose.",
    TRANSFER_IN: "Moves money between two cash / bank accounts — neither income nor expense.",
    SETTLE_INVOICES_OUT:
      "The amount settles the supplier's open invoices; any surplus stays an advance to them.",
    ADVANCE_OUT:
      "Recorded as an advance to the supplier without settling an invoice — it can be allocated later.",
    EXPENSE_OUT: "Opens the Expenses form — the expense account is chosen there.",
    OTHER_OUT:
      "Drawings, a loan repayment or a non-cash asset — debited to the counter-account you choose.",
    TRANSFER_OUT: "Moves money between two cash / bank accounts — neither income nor expense.",
  },
  titles: {
    OTHER_IN: "Other receipt",
    OTHER_OUT: "Other payment",
    TRANSFER: "Internal transfer",
  },
  sections: {
    purpose: "Purpose and party",
    amount: "Amount and account",
    allocation: "Invoices settled by this voucher",
  },
  fields: {
    amountIn: "Amount received",
    amountOut: "Amount paid",
    amountPlaceholder: "Enter amount",
    paymentMethod: "Payment method",
    accountIn: "Receiving account",
    accountOut: "Paying account",
    transferFrom: "From account",
    transferTo: "To account",
    counterAccountIn: "Counter-account (credit)",
    counterAccountOut: "Counter-account (debit)",
    currency: "Currency",
    baseCurrency: "Base currency",
  },
  counterAccounts: {
    search: "Search by account code or name",
    empty: "No authorised accounts for this direction.",
    placeholder: "Choose the counter-account",
  },
  validation: {
    counterAccountRequired: "Choose the counter-account.",
    targetAccountRequired: "Choose the account to transfer to.",
    sameAccount: "A transfer needs two different accounts.",
  },
  allocation: {
    hint: "Type the amount for each invoice in the “This voucher” column.",
    noOpenInvoices: "This party has no open invoices — the amount stays an unapplied advance.",
    thisVoucher: "This voucher",
    credited: "Credit notes",
    locked: "Paid back by an advance refund — cancel that refund to change it",
  },
  review: {
    title: "Review the voucher before confirming",
    titleUnapplied: "Review the voucher — part of the amount is unapplied",
    confirm: "Confirm and post {amount}",
    amount: "Amount",
    party: "Party",
    intoAccount: "Deposited to",
    fromAccount: "Paid from",
    method: "Payment method",
    counterAccount: "Counter-account",
    transferTo: "Transferred to",
    invoices: "Invoices to be settled",
    noInvoices: "This voucher settles no invoice.",
    unappliedIn: "{amount} stays an unapplied advance on the customer's account.",
    unappliedOut: "{amount} stays an unapplied advance to the supplier.",
    unappliedWithOpen:
      "The party has open invoices this part is not applied to. Make sure the full amount is what was actually received or paid.",
    posting:
      "The journal entry is posted on the voucher date {date} and shows on the statement at once.",
    noAccount: "No account chosen",
  },
  settlement: {
    title: "Settlement status",
    total: "Invoice total",
    paid: "Paid in cash",
    credited: "Credit notes and adjustments",
    remaining: "Remaining",
    history: "Settlement history",
    empty: "No voucher or credit note is linked to this invoice yet.",
    partialHistory:
      "Short history from the invoice data — dates and actions appear once the server is updated.",
    columns: {
      document: "Document",
      date: "Date",
      kind: "Kind",
      status: "Status",
      amount: "Amount",
    },
    kinds: {
      PAYMENT_IN: "Receipt",
      PAYMENT_OUT: "Payment",
      CREDIT_NOTE: "Credit note (return)",
    },
    actions: {
      unallocate: "Unallocate",
      editAmount: "Change amount",
      cancelVoucher: "Cancel voucher",
    },
    unallocateTitle: "Unallocate {voucher} from this invoice?",
    unallocateDescription:
      "{amount} goes back to the voucher's unapplied balance and the invoice reopens by that amount. No cash or bank movement changes.",
    editTitle: "Change the amount of {voucher} on this invoice",
    editDescription: "One server operation — no new cash movement is created.",
    cancelTitle: "Cancel voucher {voucher}?",
    cancelDescription:
      "The voucher's entry is reversed and all its allocations (on this and other invoices) are removed. This cannot be undone.",
    toasts: {
      unallocated: "Unallocated — the invoice balance is updated.",
      updated: "Allocation amount changed — the invoice balance is updated.",
      cancelled: "Voucher cancelled — the invoice balance is updated.",
    },
  },
  refund: {
    action: "Refund advance",
    title: "Refund the advance of {receipt}",
    receiptAmount: "Receipt amount",
    unapplied: "Unapplied (refundable)",
  },
  toasts: {
    reallocated: "Allocation amount updated.",
    reallocateFailed: "The allocation was not changed — the voucher was reloaded from the server.",
  },
} as const;

export default vouchersEn;
