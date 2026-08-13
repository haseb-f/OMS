import { apiClient } from "./api-client";

export interface ShippingCompanyOption {
  id: string;
  name: string;
}

/**
 * Read accessor for the Shipping Company reference data that
 * `Shipment.shippingCompanyId` actually points at (`/shipping-companies`) —
 * not to be confused with `/shipping-methods`, an unrelated master-data
 * entity. The Shipping page's filter and its "assign company" dialog are
 * the only two consumers today; no full CRUD master-data screen exists yet
 * for this entity, so this stays a minimal list-only accessor.
 */
export const shippingCompaniesService = {
  list: () => apiClient.get<ShippingCompanyOption[]>("/shipping-companies"),
};
