import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CostComponentActivityService,
  CostComponentActivityType,
} from './activities/cost-component-activity.service';
import { CreateCostComponentDto } from './dto/create-cost-component.dto';
import { UpdateCostComponentDto } from './dto/update-cost-component.dto';

@Injectable()
export class CostComponentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: CostComponentActivityService,
  ) {}

  async create(dto: CreateCostComponentDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const component = await tx.costComponent.create({ data: dto });
        await this.activityService.log(
          component.id,
          CostComponentActivityType.COST_COMPONENT_CREATED,
          `Cost component ${component.code} created`,
          undefined,
          tx,
        );
        return component;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Component code must be unique.');
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.costComponent.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const component = await this.prisma.costComponent.findFirst({
      where: { id, deletedAt: null },
    });
    if (!component) {
      throw new NotFoundException(`Cost component ${id} not found`);
    }
    return component;
  }

  async update(id: string, dto: UpdateCostComponentDto) {
    await this.findOne(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const component = await tx.costComponent.update({
          where: { id },
          data: dto,
        });
        await this.activityService.log(
          id,
          CostComponentActivityType.COST_COMPONENT_UPDATED,
          `Cost component ${component.code} updated`,
          undefined,
          tx,
        );
        return component;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Component code must be unique.');
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.costComponent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
