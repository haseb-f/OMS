import { describe, expect, it } from "vitest";
import {
  CARRIER_CHARGE_CSV_COLUMNS,
  canMarkCarrierChargePaid,
  carrierChargeCsvTemplate,
  carrierCostStage,
  signedChargeAmount,
} from "./carrier-charge-status";

describe("carrier-charge-status", () => {
  it("shows a carrier credit as a negative amount", () => {
    expect(signedChargeAmount({ chargeAmount: "25.50", chargeKind: "CREDIT" })).toBe(-25.5);
    expect(signedChargeAmount({ chargeAmount: "25.50", chargeKind: "SURCHARGE" })).toBe(25.5);
    expect(signedChargeAmount({ chargeAmount: "10", chargeKind: "BASE" })).toBe(10);
  });

  it("keeps the cost stages distinct", () => {
    expect(carrierCostStage({ reconciliationState: "UNMATCHED", paidAt: null })).toBeNull();
    expect(carrierCostStage({ reconciliationState: "MATCHED", paidAt: null })).toBe("INCURRED");
    expect(carrierCostStage({ reconciliationState: "REVIEW_REQUIRED", paidAt: null })).toBe(
      "INCURRED",
    );
    expect(carrierCostStage({ reconciliationState: "CONFIRMED", paidAt: null })).toBe("APPROVED");
    expect(carrierCostStage({ reconciliationState: "CONFIRMED", paidAt: "2026-09-29" })).toBe(
      "PAID",
    );
  });

  it("allows Mark paid only once, on an approved charge", () => {
    expect(canMarkCarrierChargePaid({ reconciliationState: "CONFIRMED", paidAt: null })).toBe(true);
    expect(
      canMarkCarrierChargePaid({ reconciliationState: "CONFIRMED", paidAt: "2026-09-29" }),
    ).toBe(false);
    expect(canMarkCarrierChargePaid({ reconciliationState: "MATCHED", paidAt: null })).toBe(false);
  });

  it("CSV template carries the optional Charge Kind column", () => {
    expect(CARRIER_CHARGE_CSV_COLUMNS).toContain("Charge Kind");
    expect(carrierChargeCsvTemplate().split("\n")[0].split(",")).toEqual([
      ...CARRIER_CHARGE_CSV_COLUMNS,
    ]);
  });
});
