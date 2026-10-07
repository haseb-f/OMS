import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const granted = new Set<string>();

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({
    user: { id: "u1" },
    isSuperAdmin: false,
    hasPermission: (name: string) => granted.has(name),
  }),
}));
vi.mock("@/services/shipping-service", () => ({
  shippingService: { statuses: () => Promise.resolve([]) },
}));
vi.mock("@/services/permissions-service", () => ({
  permissionsService: {
    getCatalog: () =>
      Promise.resolve([
        {
          sectionKey: null,
          sectionLabelKey: null,
          modules: [
            {
              key: "products",
              labelKey: "permissions.modules.products",
              actions: [
                { action: "view", name: "products.view" },
                { action: "create", name: "products.create" },
                { action: "edit", name: "products.edit" },
              ],
            },
          ],
        },
      ]),
  },
}));

import { ShipmentManageDialog } from "./shipment-manage-dialog";
import {
  ShippingCompanyQuickCell,
  TrackingNumberQuickCell,
} from "@/config/shipping/shipment-quick-edit-cells";
import { PermissionMatrix } from "@/components/settings/permission-matrix";
import type { ShipmentListRow } from "@/services/shipping-service";

afterEach(() => {
  cleanup();
  granted.clear();
});

const shipment = {
  id: "s1",
  storeOrderId: "o1",
  shippingCompanyId: "c1",
  shippingCompany: { id: "c1", name: "Aramex" },
  trackingNumber: "TRK-1",
  status: "LABEL_CREATED",
  shippingStatus: null,
  shippingCost: null,
  isCurrentAttempt: true,
  storeOrder: { internalOrderId: "STO-1", externalOrderId: null, partner: { name: "Customer" } },
} as unknown as ShipmentListRow;

const quickCtx = (canAssignCarrier: boolean) => ({
  canEdit: true,
  canAssignCarrier,
  statuses: [],
  companies: [{ id: "c1", name: "Aramex" }],
  onPatched: () => undefined,
});

/** R14 W2 (spec-2 §B) — carrier / tracking controls need shipping.assign_carrier. */
describe("shipping carrier gate", () => {
  it("shows carrier and tracking read only without shipping.assign_carrier", () => {
    granted.add("shipping.edit");
    render(
      <ShipmentManageDialog
        shipment={shipment}
        open
        onOpenChange={() => undefined}
        onUpdated={() => undefined}
        shippingCompanies={[{ id: "c1", name: "Aramex" } as never]}
      />,
    );
    expect(screen.getByText("permissionTemplates.shipping.carrierReadOnly")).toBeTruthy();
    expect(screen.getByText("Aramex")).toBeTruthy();
    expect(screen.queryByPlaceholderText("shipping.manage.trackingNumberPlaceholder")).toBeNull();
  });

  it("renders the carrier select and tracking input with shipping.assign_carrier", () => {
    granted.add("shipping.edit");
    granted.add("shipping.assign_carrier");
    render(
      <ShipmentManageDialog
        shipment={shipment}
        open
        onOpenChange={() => undefined}
        onUpdated={() => undefined}
        shippingCompanies={[{ id: "c1", name: "Aramex" } as never]}
      />,
    );
    expect(screen.queryByText("permissionTemplates.shipping.carrierReadOnly")).toBeNull();
    expect(screen.getByPlaceholderText("shipping.manage.trackingNumberPlaceholder")).toBeTruthy();
  });

  it("quick-edit carrier / tracking cells are plain text without shipping.assign_carrier", () => {
    const { container } = render(
      <>
        <ShippingCompanyQuickCell row={shipment} ctx={quickCtx(false)} />
        <TrackingNumberQuickCell row={shipment} ctx={quickCtx(false)} />
      </>,
    );
    expect(container.querySelector("button, input")).toBeNull();
    expect(screen.getByText("Aramex")).toBeTruthy();
  });

  it("quick-edit carrier / tracking cells are editable with shipping.assign_carrier", () => {
    const { container } = render(
      <>
        <ShippingCompanyQuickCell row={shipment} ctx={quickCtx(true)} />
        <TrackingNumberQuickCell row={shipment} ctx={quickCtx(true)} />
      </>,
    );
    expect(container.querySelector("button, input")).not.toBeNull();
  });
});

/** R14 W2 (spec-2 §A) — tri-state user overrides in the shared Permission Matrix. */
describe("PermissionMatrix override mode", () => {
  it("labels each permission's source and changes it tri-state", async () => {
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        overrides={{
          inherited: ["products.create", "products.edit"],
          grants: ["products.edit"],
          denies: ["products.view"],
          onChange,
        }}
      />,
    );
    fireEvent.click(await screen.findByText("permissions.modules.products"));
    expect(screen.getByText("permissionTemplates.source.inherited")).toBeTruthy();
    expect(screen.getByText("permissionTemplates.source.deny")).toBeTruthy();
    expect(
      screen.getByText(
        "permissionTemplates.source.grant · permissionTemplates.source.alsoInherited",
      ),
    ).toBeTruthy();
    // Key-level count: (template ∪ grants) − denies = create + edit.
    expect(screen.getByText("2/3")).toBeTruthy();

    const denyButtons = screen.getAllByText("permissionTemplates.state.deny");
    fireEvent.click(denyButtons[1]); // products.create
    expect(onChange).toHaveBeenCalledWith({
      grants: ["products.edit"],
      denies: ["products.view", "products.create"],
    });
  });
});
