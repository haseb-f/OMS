/**
 * paymentVocabulary namespace (en) — the ONE payment vocabulary (Round 5 spec 3A):
 * every payment screen (Payments review, reconciliation workspace, order
 * detail, agent portal, declaration dialogs) reads its state names here.
 * "Matched", "Confirmed" and "Settled" are never used interchangeably.
 */
const paymentVocabularyEn = {
  term: {
    DECLARED: {
      label: "Declared · awaiting review",
      description: "Sales or an agent reported a customer payment — nothing is verified yet.",
    },
    STATEMENT_LINE: {
      label: "Statement line · unmatched",
      description: "An imported provider or bank transaction not yet allocated to a declaration.",
    },
    LINE_ALLOCATED: {
      label: "Statement line · allocated",
      description: "The transaction is fully allocated to declarations.",
    },
    MATCHED: {
      label: "Matched · not posted",
      description:
        "Matched to a statement transaction or to a payment record by Finance; no receipt is posted yet.",
    },
    CONFIRMED: {
      label: "Confirmed & posted",
      description: "Finance posted the customer receipt to the method's clearing or cash account.",
    },
    AWAITING_SETTLEMENT: {
      label: "Awaiting settlement",
      description:
        "Posted to the provider clearing account; the provider has not paid it to the bank yet.",
    },
    PARTIALLY_SETTLED: {
      label: "Partially settled",
      description:
        "Part of the cleared amount reached the bank; the rest is still with the provider.",
    },
    SETTLED: {
      label: "Settled to bank",
      description: "The provider paid the cleared funds to the bank.",
    },
    DISPUTED: {
      label: "Disputed",
      description:
        "Finance disputed the declaration with a reason; it no longer counts as declared.",
    },
    REJECTED: {
      label: "Rejected",
      description: "Finance rejected the declaration with a reason; nothing was posted.",
    },
    EXCEPTION: {
      label: "Exception",
      description: "A statement row changed or failed after import and needs a decision.",
    },
    IGNORED: {
      label: "Ignored",
      description: "Finance set this statement row aside; it is never suggested or matched.",
    },
  },
  stageOf: "Stage {stage} of 5",
  strip: {
    label: "Payment stages",
    showAll: "Show all",
    filtered: "Filtered",
    nothing: "Nothing waiting",
    restricted: "Needs reconciliation access",
    openWorkspace: "Open",
    methods: "{count} methods",
    declared: {
      title: "Declarations awaiting review",
      description: "Filters the list to declarations Finance has not decided yet.",
    },
    unmatchedLines: {
      title: "Unmatched statement lines",
      description: "Provider transactions with no declaration yet — opens matching.",
    },
    exceptions: {
      title: "Exceptions",
      description: "Changed or failed statement rows needing a decision — opens exceptions.",
    },
    awaitingConfirmation: {
      title: "Awaiting confirmation",
      description: "Matched, not posted — confirm & post them from this list.",
    },
    partiallyAllocated: {
      title: "Partially allocated",
      description: "Statement covers part of the declaration — allocate the rest in the workspace.",
    },
    awaitingSettlement: {
      title: "Awaiting settlement",
      description: "Posted to clearing — settle to bank when the provider pays out.",
    },
  },
  action: {
    confirmPost: "Confirm & post",
    confirmMatchPost: "Confirm match & post",
    match: "Match…",
    review: "Review",
    rejectDeclaration: "Reject declaration",
    unmatch: "Unmatch",
    reversePosting: "Reverse posting",
    refundCustomer: "Refund customer",
    dispute: "Dispute",
    openWorkspace: "Open reconciliation",
    acceptStrong: "Accept strong suggestions",
  },
  reason: {
    settled: "Settled — reverse the settlement first",
    currencyDiffers: "Currency differs from the order",
    reconciledMethod: "This method is confirmed by matching its provider statement",
    alreadyPosted: "Already confirmed & posted",
    notOpen: "Only a declaration awaiting review or matched can be decided",
    activeMatches: "Has statement matches — unmatch them first",
    noPermission: "You don't have permission for this action",
    missingPrice: "Set the order's agreed amounts first",
    noOrder: "Not linked to an order",
    notPosted: "Nothing is posted yet — nothing to refund",
    noLine: "Pick a statement transaction first",
    noDebitAccount: "The payment method has no posting account",
    agentCollection: "Received by the agent — reviewed in Agent collections",
  },
  effect: {
    title: "What happens",
    confirmPost:
      "Posts a customer receipt for {amount} — Dr {account} / Cr customer receivable — for order {order}.",
    matchPost:
      "Allocates {amount} of transaction {reference} to {payment} and posts a customer receipt — Dr {account} / Cr customer receivable — for order {order}.",
    matchPartial:
      "Allocates {amount} of transaction {reference} to {payment}. Nothing is posted until the declaration is fully allocated ({remaining} left).",
    reject:
      "Rejects declaration {payment} ({amount}, order {order}) with your reason. Nothing is posted; the order's declared payment is recalculated.",
    dispute:
      "Marks declaration {payment} ({amount}, order {order}) as disputed with your reason. Shipments are never changed.",
    unmatch:
      "Releases {amount} of transaction {reference} from {payment}. Nothing was posted by this match, so no journal entry changes.",
    reversePosting:
      "Cancels customer receipt {receipt} with a reversal of journal entry {journal}, releases {amount} of transaction {reference} and returns {payment} to review.",
    bulkConfirm:
      "Posts one customer receipt and journal entry for each declaration ({totals}) to its method's account. Each is validated on its own; refusals are listed with their reason.",
    bulkReject:
      "Rejects each declaration with the shared reason. Nothing is posted; posted, settled or matched declarations are refused individually.",
    bulkAccept:
      "Confirms and posts each strong, unambiguous suggestion ({totals}) to the method's clearing account. Every other transaction is left for explicit review.",
    refund:
      "Refunds are a separate flow: record a customer refund against the posted receipt — the declaration and its posting stay unchanged.",
  },
  panel: {
    title: "Review payment {payment}",
    loading: "Loading payment…",
    declaration: "Declaration",
    statement: "Statement transaction",
    matchedTransactions: "Matched transactions",
    suggestions: "Ranked statement transactions",
    noSuggestions: "No unmatched transaction of this method and currency fits this declaration.",
    ambiguous: "Several transactions match equally well — choose the right one explicitly.",
    notReconciled:
      "This method has no provider statement — Finance confirms it from payments review.",
    restricted: "You need reconciliation access to see statement transactions.",
    evidence: "Evidence",
    discrepancy: "Discrepancy",
    noDiscrepancy: "No discrepancy",
    amountDifference: "Amount differs by {amount}",
    currencyMismatch: "Currency {line} ≠ declaration {claim}",
    dateGap: "{days} day(s) between declaration and transaction",
    attachments: "Evidence attachments",
    noAttachments: "No attachments",
    technical: "Technical details",
    select: "Select",
    selected: "Selected",
    reasonLabel: "Reason",
    reasonRequired: "A reason is required.",
    fields: {
      order: "Order",
      customer: "Customer",
      amount: "Declared amount",
      date: "Declared date",
      method: "Method",
      reference: "Reference",
      debitAccount: "Account to be debited",
      receipt: "Receipt",
      journal: "Journal entry",
      transactionDate: "Transaction date",
      payer: "Payer",
      source: "Import source",
      unallocated: "Unallocated",
      paymentId: "Payment id",
      lineId: "Line id",
      importId: "Import id",
      dedupeKey: "Dedupe key",
      rowHash: "Row hash",
      row: "Source row",
    },
    done: {
      confirmed: "Confirmed & posted — receipt {receipt}, journal entry {journal}.",
      matched: "Matched — {posted}",
      matchedPosted: "receipt posted.",
      matchedPartial: "declaration stays matched · not posted until fully allocated.",
      rejected: "Declaration {payment} rejected.",
      disputed: "Declaration {payment} disputed.",
      unmatched: "Unmatched — nothing was posted, nothing reversed.",
      reversed: "Posting reversed — receipt {receipt} cancelled.",
    },
  },
  blocked: {
    PROVIDER_STATUS_FAILED:
      "Provider status “{status}” is not a successful payment — it cannot be matched.",
    LINE_NOT_UNMATCHED:
      "This transaction is no longer unmatched — only unmatched transactions take suggestions.",
    LINE_FULLY_ALLOCATED: "This transaction is fully allocated.",
    NOT_A_PAYMENT: "Refund / chargeback lines are reviewed, never matched to a claim.",
  },
  bulk: {
    progress: "Processing {done} of {total}…",
    requestFailed:
      "The request for this group failed — nothing is known to have changed for it: {message}",
    selectedEligible: "{eligible} of {selected} selected can be processed.",
    noneEligible: "None of the selected payments can be processed this way.",
    confirmTitle: "Confirm & post {count} declarations?",
    rejectTitle: "Reject {count} declarations?",
    acceptTitle: "Accept {count} strong suggestions?",
    acceptNone: "No unmatched transaction has a strong, unambiguous suggestion.",
    planning: "Checking suggestions…",
    sharedReason: "Reason (saved on every rejected declaration)",
    resultTitle: "Bulk result",
    succeeded: "{count} done",
    failed: "{count} refused",
    failedList: "Refused — each with its reason",
    allDone: "All {count} done.",
    partial: "{succeeded} done, {failed} refused — see the reasons.",
    skipped: "{count} selected item(s) are not eligible and will not be sent.",
  },
} as const;

export default paymentVocabularyEn;
