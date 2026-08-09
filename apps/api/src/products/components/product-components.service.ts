import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductComponentDto } from '../dto/create-product-component.dto';
import { UpdateProductComponentDto } from '../dto/update-product-component.dto';

/**
 * Kit Bill of Materials (TASK-028) — plain CRUD over `ProductComponent`.
 * No cycle detection (a Kit that (indirectly) contains itself) and no
 * inventory-deduction wiring — this is the composition list only, prepared
 * for a future Sales fulfillment step to consume.
 */
@Injectable()
export class ProductComponentsService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForKit(kitProductId: string) {
    return this.prisma.productComponent.findMany({
      where: { kitProductId },
      include: { componentProduct: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(kitProductId: string, dto: CreateProductComponentDto) {
    if (dto.componentProductId === kitProductId) {
      throw new BadRequestException('A Kit cannot use itself as a component.');
    }
    try {
      return await this.prisma.productComponent.create({
        data: { kitProductId, ...dto },
        include: { componentProduct: true },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(id: string, dto: UpdateProductComponentDto) {
    await this.findOne(id);
    return this.prisma.productComponent.update({
      where: { id },
      data: dto,
      include: { componentProduct: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.productComponent.delete({ where: { id } });
  }

  private async findOne(id: string) {
    const component = await this.prisma.productComponent.findUnique({
      where: { id },
    });
    if (!component) {
      throw new NotFoundException(`Kit component ${id} not found`);
    }
    return component;
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new BadRequestException(
        'This product is already a component of this Kit.',
      );
    }
    return error as Error;
  }
}
