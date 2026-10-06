/** expenseVouchers namespace (en) — R13 owner decision 2: the Expenses screen = posting expense vouchers. */
const expenseVouchersEn = {
  title: "Expenses",
  description:
    "Record what the company spent. Save a draft, then Confirm & post: the journal entry (Dr expense account, Cr paid-from account) is created automatically.",
  addNew: "New expense",
  printTitle: "Expense voucher",
  editorTitle: "Expense",
  empty: "No expenses match these filters",
  fields: {
    number: "Expense #",
    date: "Expense date",
    expenseAccount: "Expense account",
    description: "Description",
    descriptionPlaceholder: "What was bought or paid for",
    amount: "Amount",
    currency: "Currency",
    paidFrom: "Paid from",
    paymentMethod: "Payment method",
    counterparty: "Supplier (optional)",
    costCenter: "Cost center",
    project: "Project",
    reference: "Reference",
    journalEntry: "Journal entry",
    posting: "Posting",
    status: "Status",
    createdBy: "Created by",
    notes: "Notes",
  },
  filters: {
    status: "Status",
    expenseAccount: "Expense account",
    paidFrom: "Paid from",
  },
  totals: {
    label: "Total (reversed excluded)",
  },
  posting: {
    notPosted: "Not posted (draft)",
    posted: "Posted",
    reversed: "Reversed",
  },
  rate: {
    base: "Empty = base currency",
    value: "1 {code} = {rate} {base} · rate of {date}",
    missing:
      "No exchange rate for {code} on this date — add one in Finance → Exchange rates before posting.",
  },
  actions: {
    confirmPost: "Confirm & post",
    reverse: "Reverse",
  },
  confirmDialog: {
    title: "Confirm & post this expense?",
    description:
      "A journal entry is posted now (Dr the expense account, Cr the paid-from account) and the expense can no longer be edited.",
  },
  reverseDialog: {
    title: "Reverse this expense?",
    description:
      "A reversal journal entry is posted with today's date and the expense becomes Cancelled. Refused while today's accounting period is closed or locked.",
  },
  invoices: {
    title: "{supplier} has {count} open purchase invoice(s) — {amount} unpaid",
    hint: "If this payment settles one of them, pay the invoice instead. An expense never settles an invoice, so expensing an invoiced cost would record it twice.",
    payInstead: "Pay invoice instead",
    remaining: "{amount} remaining",
  },
  validation: {
    expenseAccountRequired: "Select the expense account.",
  },
  sections: {
    dimensions: "Dimensions",
  },
  toasts: {
    saved: "Expense saved as draft — nothing posted yet.",
    posted: "Expense {number} posted — journal entry created.",
    reversed: "Expense {number} reversed — reversal entry posted.",
  },
} as const;

export default expenseVouchersEn;
