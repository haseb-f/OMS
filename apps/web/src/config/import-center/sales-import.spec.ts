import { describe, expect, it, vi } from "vitest";

const apiClient = vi.hoisted(() => ({
  get: vi.fn(() => Promise.resolve([])),
  post: vi.fn(() => Promise.resolve({})),
  delete: vi.fn(() => Promise.resolve({})),
  postForm: vi.fn(() => Promise.resolve({})),
  getBlob: vi.fn(() => Promise.resolve(new Blob())),
}));
vi.mock("@/services/api-client", () => ({ apiClient }));

import type { ImportFieldDef } from "@/services/import-types-service";
import { AGENT_IMPORT_API, COMPANY_IMPORT_API } from "@/services/import-api";
import { filterNavigationByAuth } from "@/navigation/build-navigation-tree";
import { navigationConfig } from "@/navigation/navigation.config";
import { autoMapColumns, headerKey } from "./auto-map";
import { describeImportRow } from "./row-outcome";

const field = (key: string, label: string, labelAr?: string): ImportFieldDef => ({
  key,
  label,
  labelAr,
  labelKey: `importCenter.fields.${key}`,
  required: false,
  type: "string",
});

describe("R15 sales import — automatic column matching", () => {
  const fields = [
    field("customerName", "Customer Name", "اسم العميل"),
    field("customerPhone", "Phone", "الجوال"),
    field("unitPrice", "Unit Price", "سعر الوحدة"),
    field("notes", "Notes", "ملاحظات"),
  ];

  it("matches the English or Arabic template headers (required marker ignored), the key or the localized label", () => {
    const mapping = autoMapColumns(
      fields,
      ["Customer Name *", "الجوال *", "unitPrice", "Remarks", "Agent"],
      (f) => (f.key === "notes" ? "Remarks" : f.label),
    );
    expect(mapping).toEqual({
      customerName: "Customer Name *",
      customerPhone: "الجوال *",
      unitPrice: "unitPrice",
      notes: "Remarks",
    });
  });

  it("never maps a header twice and leaves unknown fields unmapped", () => {
    const mapping = autoMapColumns(
      [field("a", "Name"), field("b", "Name")],
      ["name"],
      (f) => f.label,
    );
    expect(mapping).toEqual({ a: "name" });
    expect(headerKey("  Paid   Amount *")).toBe("paid amount");
  });
});

describe("R15 sales import — stored row outcomes", () => {
  it("reads the API's outcome prefixes", () => {
    expect(describeImportRow({ errorMessage: "SKIPPED: Already imported as order SO-1." })).toEqual(
      {
        outcome: "SKIPPED",
        reason: "Already imported as order SO-1.",
      },
    );
    expect(describeImportRow({ errorMessage: "NOTICE: Awaits stock" }).outcome).toBe(
      "CREATED_NOTICE",
    );
    expect(
      describeImportRow({ errorMessage: "NEEDS_REVIEW: Phone match", rejectedAt: "2026-10-07" })
        .outcome,
    ).toBe("REVIEW_REJECTED");
    expect(describeImportRow({ errorMessage: "Invalid phone" })).toEqual({
      outcome: "REJECTED",
      reason: "Invalid phone",
    });
  });
});

describe("R15 sales import — endpoint families", () => {
  it("agent users go through the agent portal, company users through the Import Center", async () => {
    await AGENT_IMPORT_API.jobs.list("LEADS");
    expect(apiClient.get).toHaveBeenLastCalledWith("/agent-portal/imports/jobs?importType=LEADS");
    await AGENT_IMPORT_API.jobs.run("j1");
    expect(apiClient.post).toHaveBeenLastCalledWith("/agent-portal/imports/jobs/j1/run");
    await AGENT_IMPORT_API.types.downloadSalesTemplate("STORE_ORDERS", "ar");
    expect(apiClient.getBlob).toHaveBeenLastCalledWith(
      "/agent-portal/imports/types/STORE_ORDERS/sales-template?lang=ar",
    );
    await AGENT_IMPORT_API.templates.list("LEADS");
    expect(apiClient.get).toHaveBeenLastCalledWith(
      "/agent-portal/imports/jobs/mapping-templates/LEADS",
    );
    await COMPANY_IMPORT_API.jobs.validate("j2");
    expect(apiClient.post).toHaveBeenLastCalledWith("/import-center/jobs/j2/validate");
    await COMPANY_IMPORT_API.types.sheetConnections();
    expect(apiClient.get).toHaveBeenLastCalledWith("/import-center/google-sheets/connections");
  });
});

describe("R15 sales import — agent portal navigation", () => {
  const visible = (permissions: string[]) =>
    filterNavigationByAuth(navigationConfig, permissions, {
      accessReady: true,
      userType: "AGENT",
    }).map((item) => item.id);

  it("shows Imports to an agent user holding either import key, never without one", () => {
    expect(visible(["agent.orders.import"])).toContain("agent-portal-imports");
    expect(visible(["agent.leads.import"])).toContain("agent-portal-imports");
    expect(visible(["agent.orders.create", "agent.leads.create"])).not.toContain(
      "agent-portal-imports",
    );
  });
});
