/** orderDuplicates namespace (en) — Round 5 Spec 1B duplicate warning on order creation + duplicate review. */
const orderDuplicatesEn = {
  checking: "Checking for an existing customer…",
  checkFailed:
    "Could not check for an existing customer. You can continue — the check runs again when you save.",
  required: "Choose how to handle the existing customer before saving.",
  conflictToast: "This customer already exists — choose how to continue.",
  change: "Change",
  phone: {
    title: "This customer already has orders",
    otherOrders: "{count} more order(s) owned by other team members",
    noOpenable: "Their orders belong to other team members.",
    openExisting: "Open existing order",
    newOrder: "New order for this customer",
    editDetails: "Edit details",
    chosen: "A new order will be created for the existing customer {name}.",
    active: "Active",
    closed: "Closed",
  },
  crossScope: {
    title: "This phone number belongs to a customer outside your access",
    description:
      "You can still create the order. It stays with your own customer and is sent to an internal reviewer to check for a duplicate.",
    continue: "Continue and send for review",
    chosen: "The order will be created and sent for duplicate review.",
  },
  name: {
    title: "A customer with a similar name exists",
    description:
      "If it is the same person, link the order to that customer. Otherwise a new customer is created — names alone are never merged.",
    candidate: "{count} order(s) · last {date}",
    same: "Same customer",
    different: "Different customer",
    chosenSame: "The order will be linked to the existing customer {name}.",
    chosenDifferent: "A new customer will be created for this order.",
  },
  review: {
    filter: "Duplicate review",
    action: "Resolve duplicate review",
    title: "Duplicate review",
    description:
      "The customer's phone matched a customer outside the creator's scope. Compare both sides and record the decision.",
    thisOrder: "Flagged order",
    matches: "Same phone in another scope",
    noMatches: "No other order with this phone in another scope now.",
    sameCustomer: "Same customer record — other scope",
    owner: "Owner",
    agent: "Agent",
    company: "Company",
    customer: "Customer",
    decision: "Decision",
    distinct: "Different customers — keep the order",
    duplicate: "Duplicate order",
    duplicateHint:
      "Recording a duplicate does not cancel the order — cancel it from the order page through the normal flow.",
    note: "Note",
    submit: "Save decision",
    resolved: "Duplicate review saved",
    resolvedDuplicate: "Marked as duplicate — cancel the order from its page.",
    alreadyResolved: "Resolved by {name} · {date}",
    loadFailed: "Could not load the duplicate review.",
    legacy: {
      action: "Duplicate customers",
      title: "Customers sharing a phone",
      description:
        "Records created before one phone = one customer. New orders with these phones attach to the record marked as current. Nothing is merged automatically — merge deliberately from the customers list.",
      empty: "No customers share a phone number.",
      current: "Current record",
      orders: "{count} order(s)",
      loadFailed: "Could not load the duplicate customers.",
    },
    status: {
      NONE: "No review",
      PENDING: "Pending review",
      CONFIRMED_DISTINCT: "Confirmed distinct",
      CONFIRMED_DUPLICATE: "Confirmed duplicate",
    },
  },
} as const;

export default orderDuplicatesEn;
