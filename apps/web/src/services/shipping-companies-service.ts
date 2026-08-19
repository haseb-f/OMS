import { createMasterDataService } from "./master-data-service";

export interface ShippingCompanyOption {
  id: string;
  name: string;
}

/**
 * Shipping Company reference data that `Shipment.shippingCompanyId` points
 * at (`/shipping-companies`) — not `/shipping-methods`.
 */
const crud = createMasterDataService<ShippingCompanyOption>("/shipping-companies");

export const shippingCompaniesService = {
  ...crud,
  listOptions: async (): Promise<ShippingCompanyOption[]> => {
    const result = await crud.list({ pageSize: 500 });
    return result.items.map((item) => ({ id: item.id, name: item.name }));
  },
};
