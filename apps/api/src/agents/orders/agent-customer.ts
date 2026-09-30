import {
  PartnerEntityType,
  PartnerRoleType,
  PartnerSource,
  PartnerStatus,
  type Prisma,
} from '@prisma/client';
import type { NumberingEngineService } from '../../numbering/numbering-engine.service';
import type { AgentCustomerSnapshot } from '../common/agent-terms';

/** The S1 "belongs to this agent's business" rule (see `resolveAgentCustomerPartner`), as a Partner where-fragment (also used by the Spec 1B duplicate check). */
export function agentOwnedCustomerWhere(
  agentId: string,
): Prisma.PartnerWhereInput {
  return {
    deletedAt: null,
    roles: { every: { role: PartnerRoleType.CUSTOMER } },
    storeOrders: { every: { agentId } },
    leads: { every: { agentId } },
    AND: [
      {
        OR: [
          { storeOrders: { some: { agentId } } },
          { leads: { some: { agentId } } },
        ],
      },
    ],
    agent: { is: null },
    salesQuotations: { none: {} },
    salesOrders: { none: {} },
    salesInvoices: { none: {} },
    salesReturns: { none: {} },
  };
}

/**
 * Agent customer → Partner (security finding S1).
 *
 * The company's Partner master is shared (phone / email / tax-number dedup
 * across every module). Agent flows must never adopt, update or add roles to
 * a shared Partner — that would let an agent overwrite a company customer's
 * address, attach its orders to an employee/investor identity, or probe who
 * exists (role-addition 403s). So an agent customer is deduplicated ONLY
 * among partners that belong to that same agent's business:
 *
 *  - the partner holds exactly the CUSTOMER role,
 *  - every store order and every lead of the partner belongs to this agent
 *    (and it has at least one of them), and
 *  - it is on no company document (sales quotation/order/invoice/return).
 *
 * Otherwise a new CUSTOMER partner is created (source API, person). The
 * matched partner is never updated: the customer as typed lives on the order
 * snapshot (`agentTermsSnapshot.customer`) and the portal shows only that.
 *
 * `mobile` must already be normalized (E.164) by the caller.
 */
export async function resolveAgentCustomerPartner(
  tx: Prisma.TransactionClient,
  numbering: NumberingEngineService,
  agentId: string,
  customer: AgentCustomerSnapshot,
  userId?: string,
): Promise<string> {
  if (customer.mobile) {
    const match = await tx.partner.findFirst({
      where: {
        ...agentOwnedCustomerWhere(agentId),
        OR: [{ mobile: customer.mobile }, { phone: customer.mobile }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (match) return match.id;
  }
  const partnerNumber = await numbering.generateNumber(
    'PARTNER',
    undefined,
    tx,
  );
  const partner = await tx.partner.create({
    data: {
      partnerNumber,
      name: customer.name,
      mobile: customer.mobile,
      phone: customer.mobile,
      countryId: customer.countryId,
      city: customer.city,
      address: customer.address,
      entityType: PartnerEntityType.PERSON,
      status: PartnerStatus.ACTIVE,
      source: PartnerSource.API,
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
    },
    select: { id: true },
  });
  await tx.partnerRoleAssignment.create({
    data: {
      partnerId: partner.id,
      role: PartnerRoleType.CUSTOMER,
      createdBy: userId ?? null,
    },
  });
  await tx.customerProfile.create({ data: { partnerId: partner.id } });
  return partner.id;
}
