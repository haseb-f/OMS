import { describe, expect, it } from "vitest";
import { resolveStatusColor, toneFromColorKey } from "./status-tone";
import { catalogStatusTone } from "@/config/shipping/shipment-status";

describe("resolveStatusColor", () => {
  it("passes semantic keys through", () => {
    for (const tone of ["success", "warning", "destructive", "info", "neutral"] as const) {
      expect(resolveStatusColor(tone)).toEqual({ tone });
    }
  });

  it("treats empty and unknown keys as neutral without a dot", () => {
    expect(resolveStatusColor(null)).toEqual({ tone: "neutral" });
    expect(resolveStatusColor(undefined)).toEqual({ tone: "neutral" });
    expect(resolveStatusColor("  ")).toEqual({ tone: "neutral" });
    expect(resolveStatusColor("something-else")).toEqual({ tone: "neutral" });
    expect(resolveStatusColor("#zzzzzz")).toEqual({ tone: "neutral" });
  });

  it("maps legacy color names to the closest tone", () => {
    expect(toneFromColorKey("Green")).toBe("success");
    expect(toneFromColorKey("red")).toBe("destructive");
    expect(toneFromColorKey("orange")).toBe("warning");
    expect(toneFromColorKey("blue")).toBe("info");
    expect(toneFromColorKey("gray")).toBe("neutral");
  });

  it("buckets hex colors by hue and never returns the hex as a background", () => {
    expect(resolveStatusColor("#dc2626")).toEqual({ tone: "destructive" });
    expect(resolveStatusColor("#f59e0b")).toEqual({ tone: "warning" });
    expect(resolveStatusColor("#16a34a")).toEqual({ tone: "success" });
    expect(resolveStatusColor("#2563eb")).toEqual({ tone: "info" });
    expect(resolveStatusColor("#0F8A5F")).toEqual({ tone: "success" });
    expect(resolveStatusColor("#64748b")).toEqual({ tone: "neutral" });
    expect(resolveStatusColor("#fff")).toEqual({ tone: "neutral" });
  });

  it("keeps hues without a status meaning neutral, with the color on the dot only", () => {
    expect(resolveStatusColor("#9333ea")).toEqual({ tone: "neutral", dotColor: "#9333ea" });
    expect(resolveStatusColor("purple")).toEqual({ tone: "neutral", dotColor: "purple" });
  });
});

describe("catalogStatusTone", () => {
  it("delegates to the shared mapper", () => {
    expect(catalogStatusTone("success")).toBe("success");
    expect(catalogStatusTone(null)).toBe("neutral");
    expect(catalogStatusTone("red")).toBe("destructive");
  });
});
