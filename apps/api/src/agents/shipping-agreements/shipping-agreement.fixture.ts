import type { AgentShippingService } from '@prisma/client';
import { AGENT_SHIPPING_SERVICES } from '../pricing/agent-shipping-tariff';
import type { AgentShippingAgreementsService } from './agent-shipping-agreements.service';

/**
 * Test / demo fixture: shipping agreement rows and an ACTIVE agreement
 * created through the real service (number, validation, audit).
 */
export interface ShippingRateFixture {
  service: AgentShippingService;
  countryId?: string;
  city?: string;
  amount: number;
}

/** The same charge for all four services (a flat charge to that destination). */
export const everyService = (
  amount: number,
  destination: { countryId?: string; city?: string } = {},
): ShippingRateFixture[] =>
  AGENT_SHIPPING_SERVICES.map((service) => ({
    service,
    ...destination,
    amount,
  }));

export async function activateShippingAgreement(
  agreements: AgentShippingAgreementsService,
  agentId: string,
  rates: ShippingRateFixture[],
  userId: string,
  dates: { effectiveFrom: string; effectiveTo?: string } = {
    effectiveFrom: '2020-01-01',
  },
) {
  const draft = await agreements.create(agentId, { ...dates, rates }, userId);
  return agreements.activate(agentId, draft.id, {}, userId);
}
