/** assetSchedules namespace (en) — R13 spec C: fixed-asset / prepaid schedules, detail screens, invoice links. */
const assetSchedulesEn = {
  status: {
    PENDING: "Pending",
    POSTED: "Posted",
    CANCELLED: "Cancelled",
    FAILED: "Not posted",
  },
  methods: {
    STRAIGHT_LINE: "Straight line",
    DECLINING_BALANCE: "Declining balance",
  },
  columns: {
    period: "Period",
    start: "From",
    end: "Posting date",
    amount: "Amount",
    status: "Status",
    journal: "Journal entry",
    lastError: "Last error",
    cumulative: "Cumulative",
    bookValue: "Book value",
    remaining: "Remaining",
  },
  sections: {
    parameters: "Parameters",
    schedule: "Depreciation schedule",
    recognitionSchedule: "Recognition schedule",
    preview: "Schedule preview",
    previewSummary: "{count} monthly period(s) · {start} → {end}",
  },
  fields: {
    method: "Depreciation method",
    bookValue: "Book value",
    remainingDepreciable: "Remaining to depreciate",
    periodsPosted: "Periods posted",
    periodsPending: "Periods pending",
    periodsFailed: "Not posted (see last error)",
    disposalDate: "Disposal date",
    disposalNotes: "Notes",
    sourceInvoice: "Source invoice",
    sourceLine: "Invoice line",
    remainingAmount: "Remaining balance",
    lineNet: "Net amount",
    endDateDerived: "End date = start + periods − 1 day (set automatically).",
  },
  links: {
    sourceInvoice: "Purchase invoice",
    capitalizationEntry: "Capitalization entry",
    disposalEntry: "Disposal entry",
    deferralEntry: "Deferral entry",
    fixedAssets: "Fixed assets",
    prepaidExpenses: "Prepaid expenses",
    linkedRecord: "Linked record",
    linkedRecordPending: "Created when the invoice is confirmed",
  },
  actions: {
    open: "Open",
    processDue: "Process due entries",
    linkInvoiceLine: "Link purchase invoice line",
    unlinkInvoiceLine: "Unlink invoice line",
    viewList: "Back to list",
  },
  dialogs: {
    capitalizeDescription:
      "Posts the capitalization entry and stores this schedule. Each period posts automatically when its date arrives.",
    capitalizeNeedsLife: "Set the useful life (months) on the asset before capitalizing.",
    activateDescription:
      "Posts the payment to Prepayments. Each recognition posts automatically when its period ends.",
    processDueDescription:
      "Posts every depreciation and prepaid recognition whose period has ended (today in Cairo). Entries already posted are never posted twice.",
    disposeDescription:
      "Depreciation through the disposal date is posted first; the remaining periods are cancelled, then the asset is derecognized.",
    linkDescription:
      "Choose a fixed-asset line of a draft purchase invoice. When that invoice is confirmed, this asset is capitalized by it (cost = the line's net amount) — no second asset and no second entry.",
    linkPlaceholder: "Search by invoice, reference or supplier",
    noLinkableLines: "No unlinked fixed-asset lines on draft purchase invoices.",
    linkedNotice: "Linked to {invoice}. This asset is capitalized when that invoice is confirmed.",
  },
  toasts: {
    processed: "{posted} entr(ies) posted.",
    processedWithFailures:
      "{posted} entr(ies) posted; {failed} could not be posted — see the last error on the schedule.",
    nothingDue: "Nothing is due — every period that has ended is already posted.",
    linked: "Invoice line linked.",
    unlinked: "Invoice line unlinked.",
  },
} as const;

export default assetSchedulesEn;
