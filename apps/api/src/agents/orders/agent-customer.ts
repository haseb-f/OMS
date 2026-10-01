import { PartnerSource, type Prisma } from '@prisma/client';
import type { NumberingEngineService } from '../../numbering/numbering-engine.service';
import type { PhoneNumberService } from '../../common/phone/phone-number.service';
import {
  ensureCustomerRole,
  findOrCreateCustomerPartnerTx,
} from '../../partners/partner-phone-keys';
import type { AgentCustomerSnapshot } from '../common/agent-terms';

/**
 * The agent's customer scope for the duplicate check (Spec 1B, O3): a
 * customer this agent already sold to (an order) or works with (a lead). The
 * record may be shared with the company or other agents (one phone = one
 * customer) — the agent still sees only its own orders and the customer as
 * it typed it. A phone match outside this scope is cross-scope.
 */
export function agentCustomerScopeWhere(
  agentId: string,
): Prisma.PartnerWhereInput {
  return {
    deletedAt: null,
    OR: [
      { storeOrders: { some: { agentId, deletedAt: null } } },
      { leads: { some: { agentId } } },
    ],
  };
}

/**
 * Agent customer → Partner.
 *
 * Owner decision O3 (2026-10-01, supersedes the S1 "own customers only"
 * dedup): one phone number = one customer. The partner owning the mobile —
 * in any scope (company, this agent, another agent) — is reused; otherwise a
 * new CUSTOMER partner (source API, person) is created, race-safe through
 * `partner_phone_keys`. Agent isolation stays at the order level: the
 * matched partner is never updated (the customer as typed lives on the order
 * snapshot `agentTermsSnapshot.customer`, which is all the portal shows) and
 * only a missing CUSTOMER role is added — whatever the record's other roles,
 * so the agent learns nothing about who holds the number. A match
 * outside the agent's scope is flagged for internal duplicate review by the
 * caller (`StoreOrderDuplicatesService`).
 *
 * `mobile` must already be normalized (E.164) by the caller.
 * `confirmedPartnerId`: the customer the duplicate check resolved (in or
 * outside the agent's scope) — reused with the same role guard.
 */
export async function resolveAgentCustomerPartner(
  tx: Prisma.TransactionClient,
  deps: { numbering: NumberingEngineService; phones: PhoneNumberService },
  customer: AgentCustomerSnapshot,
  userId?: string,
  confirmedPartnerId?: string | null,
): Promise<string> {
  if (confirmedPartnerId) {
    await ensureCustomerRole(tx, confirmedPartnerId, userId);
    return confirmedPartnerId;
  }
  const { partnerId } = await findOrCreateCustomerPartnerTx(
    tx,
    deps,
    {
      name: customer.name,
      phone: customer.mobile,
      mobile: customer.mobile,
      countryId: customer.countryId,
      city: customer.city,
      address: customer.address,
      source: PartnerSource.API,
    },
    userId,
  );
  return partnerId;
}
