import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadActivityService,
  LeadActivityType,
} from './activities/lead-activity.service';
import { LeadDuplicateDetectionService } from './duplicate-detection/lead-duplicate-detection.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ArchiveLeadDto } from './dto/archive-lead.dto';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
    private readonly leadDuplicateDetectionService: LeadDuplicateDetectionService,
  ) {}

  private async generateLeadNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('lead_number_seq')`;
    return `LD-${result[0].nextval.toString().padStart(6, '0')}`;
  }

  private async transitionStatus(
    id: string,
    status: LeadStatus,
    activityType: string,
    description: string,
    extraData: Prisma.LeadUpdateInput = {},
  ) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: { status, ...extraData },
      });
      await this.leadActivityService.log(
        id,
        activityType,
        description,
        { previousStatus: existing.status, newStatus: status },
        tx,
      );
      return updated;
    });
  }

  async create(dto: CreateLeadDto) {
    const duplicateCheck = await this.leadDuplicateDetectionService.check({
      mobileNumber: dto.mobileNumber,
      customerName: dto.customerName,
      productId: dto.productId,
    });

    if (duplicateCheck.isExactDuplicate) {
      throw new ConflictException('Duplicate Lead');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const leadNumber = await this.generateLeadNumber(tx);
        const lead = await tx.lead.create({
          data: {
            ...dto,
            leadNumber,
            status: LeadStatus.NEW,
            possibleDuplicate: duplicateCheck.isPossibleDuplicate,
          },
        });
        await this.leadActivityService.log(
          lead.id,
          LeadActivityType.LEAD_CREATED,
          `Lead ${lead.leadNumber} created`,
          undefined,
          tx,
        );
        return lead;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid country, currency, or sales employee reference.',
        );
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.lead.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${id} not found`);
    }
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    const existing = await this.findOne(id);
    const statusChanged =
      dto.status !== undefined && dto.status !== existing.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.lead.update({ where: { id }, data: dto });
        if (statusChanged) {
          await this.leadActivityService.log(
            id,
            LeadActivityType.LEAD_STATUS_CHANGED,
            `Lead status changed from ${existing.status} to ${updated.status}`,
            { from: existing.status, to: updated.status },
            tx,
          );
        }
        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid country, currency, or sales employee reference.',
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Business operation: change status to UNDER_FOLLOW_UP. */
  startFollowUp(id: string) {
    return this.transitionStatus(
      id,
      LeadStatus.UNDER_FOLLOW_UP,
      LeadActivityType.FOLLOW_UP_STARTED,
      'Follow-up Started',
    );
  }

  /** Business operation: change status to PAID. The Orders module continues the workflow from here. */
  markPaid(id: string) {
    return this.transitionStatus(
      id,
      LeadStatus.PAID,
      LeadActivityType.MARKED_PAID,
      'Marked Paid',
    );
  }

  /** Business operation: change status to ARCHIVED. Archive reason is optional. */
  archive(id: string, dto: ArchiveLeadDto) {
    return this.transitionStatus(
      id,
      LeadStatus.ARCHIVED,
      LeadActivityType.ARCHIVED,
      'Archived',
      {
        archivedReason: dto.archiveReason ?? null,
      },
    );
  }
}
