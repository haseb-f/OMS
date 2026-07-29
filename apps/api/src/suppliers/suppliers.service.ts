import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SupplierStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SupplierActivityService,
  SupplierActivityType,
} from './activities/supplier-activity.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { FindSuppliersQueryDto } from './dto/find-suppliers-query.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: SupplierActivityService,
  ) {}

  async create(dto: CreateSupplierDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplierNumber = await this.generateSupplierNumber(tx);
        const supplier = await tx.supplier.create({
          data: { ...dto, supplierNumber },
        });
        await this.activityService.log(
          supplier.id,
          SupplierActivityType.SUPPLIER_CREATED,
          `Supplier ${supplier.code} created`,
          undefined,
          tx,
        );
        return supplier;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Supplier code must be unique.');
      }
      throw error;
    }
  }

  /** "Search" — filters by Status; matches Code/Name/Commercial Name. */
  findAll(query: FindSuppliersQueryDto) {
    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      status: query.status,
    };

    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { commercialName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.supplier.findMany({ where });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.update({ where: { id }, data: dto });
        await this.activityService.log(
          id,
          SupplierActivityType.SUPPLIER_UPDATED,
          `Supplier ${supplier.code} updated`,
          undefined,
          tx,
        );
        return supplier;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Supplier code must be unique.');
      }
      throw error;
    }
  }

  /** Soft delete. */
  async archive(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.activityService.log(
        id,
        SupplierActivityType.SUPPLIER_ARCHIVED,
        `Supplier ${existing.code} archived`,
        undefined,
        tx,
      );
      return supplier;
    });
  }

  /** Sets Status back to ACTIVE — the counterpart of manually setting it to INACTIVE via Update. */
  async activate(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id },
        data: { status: SupplierStatus.ACTIVE },
      });
      await this.activityService.log(
        id,
        SupplierActivityType.SUPPLIER_UPDATED,
        `Supplier ${existing.code} activated`,
        undefined,
        tx,
      );
      return supplier;
    });
  }

  private async generateSupplierNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('supplier_number_seq')`;
    return `SUP-${result[0].nextval.toString().padStart(6, '0')}`;
  }
}
