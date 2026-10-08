import { apiClient } from "@/services/api-client";
import {
  agentPortalService,
  type OrderQuote,
  type PricingInput,
} from "@/services/agent-portal-service";
import { agentsService } from "@/services/agents-service";
import type { ShippingHandoffBlocker } from "@/services/shipping-service";
import { productsService } from "@/services/products-service";
import {
  orderDuplicatesService,
  type DuplicateCheckInput,
  type DuplicateCheckResult,
} from "@/services/order-duplicates-service";
import type {
  AgentConvertLeadPayload,
  AgentCreateOrderPayload,
} from "@/config/orders/agent-order-entry";

/**
 * Where the agent adapter of the order-entry flow reads and writes (R15 W1):
 * an agent user in the portal (`/agent-portal/*`, the agent from the token) or
 * company staff entering an order for one agent (internal `/agent-orders`, the
 * agent named in the request). Same steps and rules — only the endpoints, the
 * product source and the permission names differ; the server enforces all of
 * them either way.
 */
export interface AgentEntryProduct {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  displayName: string | null;
  listPrice: number | null;
  /** Available to sell as the API reports it; null = not visible / not a stock item. */
  available: number | null;
  isInventoryItem: boolean;
  supplyMethod?: string | null;
}

export interface AgentEntryDestination {
  id: string;
  label: string;
  ownership: "COMPANY" | "AGENT";
  details: string | null;
  methodName: string | null;
}

export interface AgentEntryResult {
  id: string;
  internalOrderId: string;
  /** Portal responses only: whether / why the order went to Shipping. */
  fulfillment?: { shippingBlocker?: ShippingHandoffBlocker | null; shipments: unknown[] };
  paymentType?: string;
}

export interface AgentEntrySource {
  kind: "portal" | "staff";
  orderHref: (orderId: string) => string;
  products: () => Promise<AgentEntryProduct[]>;
  /** Staff: availability is read per product from the inventory API for this owner (the agent). */
  availabilityOwner: string | null;
  quote: (input: PricingInput) => Promise<OrderQuote>;
  create: (payload: AgentCreateOrderPayload) => Promise<AgentEntryResult>;
  convert: (leadId: string, payload: AgentConvertLeadPayload) => Promise<AgentEntryResult>;
  destinations: () => Promise<AgentEntryDestination[]>;
  checkDuplicates: (input: DuplicateCheckInput) => Promise<DuplicateCheckResult>;
  /** Staff only: the agent's users who may own the order. */
  owners: (() => Promise<Array<{ id: string; fullName: string }>>) | null;
  /** The permission the declaration at create needs (any-of). */
  declarePermissions: readonly string[];
}

/** The agent portal: everything scoped to the caller's agent by the server. */
export const portalAgentEntrySource: AgentEntrySource = {
  kind: "portal",
  orderHref: (orderId) => `/agent/orders/${orderId}`,
  products: async () =>
    (await agentPortalService.products({ pageSize: 200 })).items.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameEn: product.nameEn,
      displayName: product.displayName,
      listPrice: product.listPrice,
      available: product.available,
      isInventoryItem: product.isInventoryItem,
    })),
  availabilityOwner: null,
  quote: (input) => agentPortalService.orders.quote(input),
  create: (payload) => agentPortalService.orders.create(payload),
  convert: (leadId, payload) => agentPortalService.leads.convert(leadId, payload),
  destinations: async () =>
    (await agentPortalService.paymentDestinations()).map((destination) => ({
      id: destination.id,
      label: destination.label,
      ownership: destination.ownership,
      details: destination.details,
      methodName: destination.method.name,
    })),
  checkDuplicates: orderDuplicatesService.checkAsAgent,
  owners: null,
  declarePermissions: ["agent.payments.declare"],
};

/** Company staff entering an order for `agentId` (`agents.edit`, or `store-orders.create` + `agents.view`). */
export function staffAgentEntrySource(agentId: string): AgentEntrySource {
  return {
    kind: "staff",
    orderHref: (orderId) => `/store-orders/${orderId}`,
    products: async () =>
      (
        await productsService.catalog({
          agentId,
          isSellable: true,
          pageSize: 200,
          sortBy: "displayName",
          sortOrder: "asc",
        })
      ).items.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        nameEn: null,
        displayName: product.displayName,
        listPrice: product.salesPrice == null ? null : Number(product.salesPrice),
        available: null,
        isInventoryItem: product.isInventoryItem,
        supplyMethod: product.supplyMethod,
      })),
    availabilityOwner: agentId,
    quote: (input) => apiClient.post<OrderQuote>("/agent-orders/quote", { ...input, agentId }),
    create: (payload) => apiClient.post<AgentEntryResult>("/agent-orders", { ...payload, agentId }),
    convert: (leadId, payload) =>
      apiClient.post<AgentEntryResult>(`/agent-orders/leads/${leadId}/convert`, {
        ...payload,
        agentId,
      }),
    destinations: async () =>
      (await agentsService.destinations.list(agentId))
        .filter((destination) => destination.isActive && destination.paymentMethod?.isActive)
        .map((destination) => ({
          id: destination.id,
          label: destination.label,
          ownership: destination.ownership,
          details: destination.details,
          methodName: destination.paymentMethod?.name ?? null,
        })),
    checkDuplicates: (input) => orderDuplicatesService.check({ ...input, agentId }),
    owners: async () =>
      (await agentsService.users.list(agentId))
        .filter((user) => user.isActive)
        .map((user) => ({ id: user.id, fullName: user.fullName })),
    // Same any-of rule the API applies to a declaration by internal staff.
    declarePermissions: ["store-orders.edit", "sales.receipts.create"],
  };
}
