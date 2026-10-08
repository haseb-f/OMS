import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { ImportTypeDefinition } from "@/services/import-types-service";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(messages.en, key, params),
    locale: "en",
    direction: "ltr",
  }),
}));
// Every call reaches the (mocked) server — no session cache between cases.
vi.mock("@/lib/lookup-cache", () => ({
  cachedLookup: (_key: string, load: () => Promise<unknown>) => load(),
}));
const typesList = vi.hoisted(() => vi.fn<() => Promise<ImportTypeDefinition[]>>());
vi.mock("@/services/import-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/import-api")>();
  return {
    ...actual,
    COMPANY_IMPORT_API: {
      ...actual.COMPANY_IMPORT_API,
      types: { ...actual.COMPANY_IMPORT_API.types, list: typesList },
    },
  };
});

import { ModuleImportButtons } from "./module-import-buttons";

const leads = (canImport: boolean): ImportTypeDefinition => ({
  type: "LEADS",
  labelKey: "importCenter.types.leads.label",
  descriptionKey: "importCenter.types.leads.description",
  fields: [],
  isAvailable: true,
  canImport,
  salesFields: ["customerName"],
});

afterEach(cleanup);

/**
 * R15 (D15-16) — the Leads import menu follows the server's per-type
 * decision (`crm.leads.import`, or `import-center.manage`), never an Import
 * Center role on the client.
 */
describe("ModuleImportButtons — per-type import permission", () => {
  it("shows the import menu when the server says the user may import the type", async () => {
    typesList.mockResolvedValueOnce([leads(true)]);
    render(<ModuleImportButtons importType="LEADS" />);
    expect(await screen.findByText(translate(messages.en, "docFlow.import.menu"))).toBeTruthy();
  });

  it("hides it for a type the user may not import (dashboard viewers get canImport=false)", async () => {
    typesList.mockResolvedValueOnce([leads(false)]);
    render(<ModuleImportButtons importType="LEADS" />);
    await waitFor(() => expect(typesList).toHaveBeenCalled());
    expect(screen.queryByText(translate(messages.en, "docFlow.import.menu"))).toBeNull();
  });
});
