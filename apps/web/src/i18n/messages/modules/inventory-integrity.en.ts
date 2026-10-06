/** inventoryIntegrity namespace (en) - R13: inventory integrity report (invariants I1-I7, valuation vs GL). */
const inventoryIntegrityEn = {
  title: "Inventory integrity",
  description:
    "Checks the stock ledger, assemblies, kit sales and agent stock, and compares the stock valuation with the posted inventory accounts. Read-only: nothing is corrected here.",
  run: "Run check",
  rerun: "Run again",
  exportJson: "Export JSON",
  exported: "Report exported",
  completed: "Integrity check completed",
  notRun: "Run the check to see the current state of inventory integrity.",
  costRequired:
    "This report shows valuation and ledger figures. It needs inventory access and a costing permission (Product Cost or Cost Explorer).",
  overall: "Overall result",
  generatedAt: "Checked at",
  duration: "Duration",
  durationMs: "{ms} ms",
  checked: "Checked",
  findings: "Findings",
  findingsShown: "Showing {shown} of {total} findings",
  showFindings: "Show findings",
  noFindings: "No findings.",
  metrics: "Figures",
  notes: "Scope and notes",
  rule: "Rule",
  severity: "Severity",
  message: "Details",
  status: {
    PASS: "Pass",
    WARN: "Review",
    FAIL: "Fail",
  },
  summary: {
    PASS: "Passed",
    WARN: "Needs review",
    FAIL: "Failed",
  },
  invariants: {
    I1: "Movement chain per product and warehouse",
    I2: "No negative stock; reserved within on-hand",
    I3: "No duplicate document-line movements",
    I4: "Assembly orders: cost, consumption and journal",
    I5: "Kit sales: component deliveries and COGS once",
    I6: "Inventory valuation vs GL inventory accounts",
    I7: "Agent-owned stock stays outside company books",
  },
};

export default inventoryIntegrityEn;
