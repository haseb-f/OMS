import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DepartmentsService } from '../departments/departments.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateSalesTeamDto, UpdateSalesTeamDto } from './dto/sales-team.dto';

const INCLUDE = {
  department: {
    select: {
      id: true,
      code: true,
      name: true,
      nameEn: true,
      isActive: true,
      deletedAt: true,
    },
  },
  manager: { select: { id: true, fullName: true, username: true } },
  members: {
    include: {
      user: { select: { id: true, fullName: true, username: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SalesTeamInclude;

@Injectable()
export class SalesTeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departments: DepartmentsService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  private async assertActiveUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, isActive: true, departmentId: true, fullName: true },
    });
    if (!user) {
      throw new BadRequestException(`User ${id} not found.`);
    }
    if (!user.isActive) {
      throw new BadRequestException(`${user.fullName} is inactive.`);
    }
    return user;
  }

  async create(dto: CreateSalesTeamDto, userId?: string) {
    await this.departments.assertAssignable(dto.departmentId);
    const manager = await this.assertActiveUser(dto.managerId);
    const memberIds = (dto.memberIds ?? []).filter((id) => id !== manager.id);
    for (const id of memberIds) {
      await this.assertActiveUser(id);
    }

    const code = await this.numberingEngine.generateNumber('SALES_TEAM');
    return this.prisma.salesTeam.create({
      data: {
        code,
        name: dto.name.trim(),
        departmentId: dto.departmentId,
        managerId: dto.managerId,
        notes: dto.notes?.trim() || null,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        members: memberIds.length
          ? {
              create: memberIds.map((id) => ({
                userId: id,
                createdBy: userId ?? null,
              })),
            }
          : undefined,
      },
      include: INCLUDE,
    });
  }

  async findAll(search?: string) {
    const where: Prisma.SalesTeamWhereInput = { deletedAt: null };
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { code: { contains: search.trim(), mode: 'insensitive' } },
        {
          department: {
            name: { contains: search.trim(), mode: 'insensitive' },
          },
        },
      ];
    }
    return this.prisma.salesTeam.findMany({
      where,
      include: INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const team = await this.prisma.salesTeam.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!team) throw new NotFoundException(`Sales Team ${id} not found.`);
    return team;
  }

  async update(id: string, dto: UpdateSalesTeamDto, userId?: string) {
    const existing = await this.findOne(id);
    if (dto.departmentId && dto.departmentId !== existing.departmentId) {
      await this.departments.assertAssignable(dto.departmentId);
    }
    const managerId = dto.managerId ?? existing.managerId;
    if (dto.managerId) {
      await this.assertActiveUser(dto.managerId);
    }
    const memberIds =
      dto.memberIds !== undefined
        ? dto.memberIds.filter((memberId) => memberId !== managerId)
        : undefined;
    if (memberIds) {
      for (const memberId of memberIds) {
        await this.assertActiveUser(memberId);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (memberIds) {
        await tx.salesTeamMember.deleteMany({ where: { salesTeamId: id } });
        if (memberIds.length) {
          await tx.salesTeamMember.createMany({
            data: memberIds.map((memberId) => ({
              id: crypto.randomUUID(),
              salesTeamId: id,
              userId: memberId,
              createdBy: userId ?? null,
            })),
          });
        }
      }
      return tx.salesTeam.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          departmentId: dto.departmentId,
          managerId: dto.managerId,
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
          updatedBy: userId ?? null,
        },
        include: INCLUDE,
      });
    });
  }

  async archive(id: string, userId?: string) {
    await this.findOne(id);
    return this.prisma.salesTeam.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
      include: INCLUDE,
    });
  }

  async restore(id: string, userId?: string) {
    const team = await this.prisma.salesTeam.findFirst({ where: { id } });
    if (!team) throw new NotFoundException(`Sales Team ${id} not found.`);
    await this.departments.assertAssignable(team.departmentId);
    return this.prisma.salesTeam.update({
      where: { id },
      data: { deletedAt: null, updatedBy: userId ?? null },
      include: INCLUDE,
    });
  }
}
