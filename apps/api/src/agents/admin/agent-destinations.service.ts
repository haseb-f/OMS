import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import { resolveActiveAgreement } from './agent-agreements.service';
import type { CreatePaymentDestinationDto } from './dto/destination.dto';

const DESTINATION_INCLUDE = {
  paymentMethod: { select: { id: true, name: true, isActive: true } },
} as const;

/**
 * Payment destinations an agent's Sales may choose (spec §2, §7). Managed
 * by internal `agents.edit` only. AGENT-owned rows need the agent's
 * current agreement to allow agent destinations.
 */
@Injectable()
export class AgentDestinationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(agentId: string, activeOnly = false) {
    await this.requireAgent(agentId);
    return this.prisma.agentPaymentDestination.findMany({
      where: { agentId, ...(activeOnly ? { isActive: true } : {}) },
      include: DESTINATION_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { label: 'asc' }],
    });
  }

  async create(
    agentId: string,
    dto: CreatePaymentDestinationDto,
    userId: string,
  ) {
    await this.requireAgent(agentId);
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: dto.paymentMethodId, deletedAt: null },
      select: { isActive: true },
    });
    if (!method?.isActive) {
      throw agentUnprocessable(
        'PAYMENT_METHOD_INACTIVE',
        'طريقة الدفع غير موجودة أو غير نشطة',
        'The payment method does not exist or is not active.',
      );
    }
    if (dto.ownership === 'AGENT') {
      await this.assertAgentDestinationsAllowed(agentId);
    }
    const existing = await this.prisma.agentPaymentDestination.findUnique({
      where: {
        agentId_paymentMethodId_ownership: {
          agentId,
          paymentMethodId: dto.paymentMethodId,
          ownership: dto.ownership,
        },
      },
    });
    if (existing?.isActive) {
      throw agentConflict(
        'DESTINATION_EXISTS',
        'وجهة الدفع هذه موجودة بالفعل للوكيل',
        'This payment destination already exists for the agent.',
      );
    }
    if (existing) {
      // Re-adding a deactivated destination revives the same row (payments
      // already reference it) with the new label/details.
      return this.prisma.agentPaymentDestination.update({
        where: { id: existing.id },
        data: { isActive: true, label: dto.label, details: dto.details },
        include: DESTINATION_INCLUDE,
      });
    }
    return this.prisma.agentPaymentDestination.create({
      data: {
        agentId,
        paymentMethodId: dto.paymentMethodId,
        ownership: dto.ownership,
        label: dto.label,
        details: dto.details,
        createdBy: userId,
      },
      include: DESTINATION_INCLUDE,
    });
  }

  async setActive(agentId: string, destinationId: string, isActive: boolean) {
    const destination = await this.prisma.agentPaymentDestination.findFirst({
      where: { id: destinationId, agentId },
    });
    if (!destination) {
      throw agentNotFoundError('Payment destination', 'وجهة الدفع');
    }
    if (isActive && destination.ownership === 'AGENT') {
      await this.assertAgentDestinationsAllowed(agentId);
    }
    return this.prisma.agentPaymentDestination.update({
      where: { id: destinationId },
      data: { isActive },
      include: DESTINATION_INCLUDE,
    });
  }

  private async assertAgentDestinationsAllowed(agentId: string) {
    const agreement = await resolveActiveAgreement(
      agentId,
      new Date(),
      this.prisma,
    );
    if (!agreement?.allowAgentDestinations) {
      throw agentUnprocessable(
        'AGENT_DESTINATIONS_NOT_ALLOWED',
        'الاتفاقية الحالية لا تسمح بالدفع مباشرة للوكيل',
        'The agent’s current agreement does not allow payments straight to the agent.',
      );
    }
  }

  private async requireAgent(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { id: true },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
  }
}
