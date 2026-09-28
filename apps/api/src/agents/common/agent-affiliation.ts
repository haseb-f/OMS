import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type UserReader = Pick<Prisma.TransactionClient, 'user'>;

export interface AffiliationErrors {
  /** Agent record, target is not an active user of that agent. */
  agentScope: { code: string; message: string };
  /** Company record, target is an agent user. */
  internalOnly: { code: string; message: string };
  notFound: string;
}

/**
 * Owner affiliation rule shared by lead assignment and store-order owner
 * writes (spec §3, S4): an agent's record is owned only by an active,
 * unlocked user of the same agent; a company record only by an internal user.
 */
export async function assertOwnerAffiliation(
  client: UserReader,
  recordAgentId: string | null,
  targetUserId: string,
  errors: AffiliationErrors,
) {
  const target = await client.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    select: { userType: true, agentId: true, isActive: true, isLocked: true },
  });
  if (!target) throw new BadRequestException(errors.notFound);
  if (recordAgentId) {
    if (
      target.userType !== 'AGENT' ||
      target.agentId !== recordAgentId ||
      !target.isActive ||
      target.isLocked
    ) {
      throw new ForbiddenException(errors.agentScope);
    }
  } else if (target.userType !== 'INTERNAL') {
    throw new ForbiddenException(errors.internalOnly);
  }
}

export const STORE_ORDER_OWNER_ERRORS: AffiliationErrors = {
  agentScope: {
    code: 'AGENT_ORDER_OWNER_SCOPE',
    message:
      'مالك طلب الوكيل يجب أن يكون مستخدمًا نشطًا من نفس الوكيل — An agent order can only be owned by an active user of the same agent.',
  },
  internalOnly: {
    code: 'AGENT_USER_NOT_ASSIGNABLE',
    message:
      'لا يمكن إسناد طلب للشركة إلى مستخدم وكيل — A company order cannot be owned by an agent user.',
  },
  notFound: 'Order owner not found.',
};
