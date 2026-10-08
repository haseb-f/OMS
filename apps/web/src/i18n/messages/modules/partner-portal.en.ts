/** partnerPortal namespace (en) — R15 W4: a company partner's own portal. */
const partnerPortalEn = {
  identity: {
    portal: "Partner portal",
  },
  nav: {
    overview: "Overview",
    statement: "Statement",
  },
  overview: {
    title: "Overview",
    description: "Your profit share: what is estimated, approved, paid and still due.",
    currentPeriod: "Current period",
    approved: "Approved to date",
    paid: "Paid to date",
    payable: "Still due",
    advance: "Paid in advance",
    lastPayment: "Last payment",
    noPayment: "No payment yet",
    agreement: "Your agreement",
    share: "Profit share",
    basis: "Basis",
    frequency: "Closing",
    from: "From",
    to: "To",
    status: "Status",
    recentPeriods: "Recent periods",
    recentPeriodsHint: "Reviewed and closed periods",
    noPeriods: "No period has been reviewed or closed yet.",
    openStatement: "Open statement",
    signedInAs: "Signed in as",
    noAgreement: "No agreement is recorded for you yet.",
  },
  statement: {
    title: "Statement",
    description: "Your profit per closing period — estimate, approved, paid and remaining.",
  },
} as const;

export default partnerPortalEn;
