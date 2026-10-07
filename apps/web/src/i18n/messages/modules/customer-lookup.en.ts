/** customerLookup namespace (en) — R7 advanced customer lookup (`customers.lookup_advanced`). */
const customerLookupEn = {
  trigger: "Advanced customer lookup",
  title: "Advanced customer lookup",
  description:
    "Check whether a customer already exists and who it belongs to. Every search is logged — this does not let you open or edit the customer's records.",
  queryLabel: "Phone number, customer name or order number",
  placeholder: "Phone (any format), first and last name, or STO-2026-000123",
  search: "Search",
  hintMinimum:
    "Enter a phone number of at least 7 digits, the customer's first and last name, or an order number.",
  notice: "Every search is recorded. Repeated searches are rate-limited.",
  loading: "Searching…",
  idle: "Search by phone number, name or order number to see whether the customer exists.",
  empty: "No matching customer was found.",
  error: "The lookup failed. Please try again.",
  forbidden:
    "You do not have access to advanced customer lookup. Ask an administrator to grant it.",
  searchAll: "Search all customers",
  searchAllHint:
    "Not in your list? The advanced lookup can find a customer another employee owns (read-only).",
  rateLimited: "Too many lookups. Please wait a few minutes before searching again.",
  tooShort: "The search text is too short.",
  capped: "More matches exist. Refine the search to narrow them down.",
  remaining: "{count} lookups left in this period",
  found: "{count} matching customer(s) found.",
  columns: {
    customer: "Customer",
    reference: "Latest record",
    status: "Status",
    assignment: "Assignment",
    action: "",
  },
  kind: {
    CUSTOMER: "Customer",
    LEAD: "Lead",
  },
  referenceType: {
    ORDER: "Order",
    LEAD: "Lead",
  },
  noReference: "No order or lead yet",
  status: {
    IN_PROGRESS: "In progress",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    RETURNED: "Returned",
    OPEN: "Open",
    CONVERTED: "Converted",
    CLOSED: "Closed",
  },
  notAssignedToYou: "Not assigned to you",
  assignedToYou: "Assigned to you",
  previousOrders: "Previous orders",
  moreOrders: "+{count} more",
  open: "Open",
  noAccess: "Not available to you",
} as const;

export default customerLookupEn;
