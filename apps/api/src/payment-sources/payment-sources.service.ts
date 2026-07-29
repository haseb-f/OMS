import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentSourceDto } from './dto/create-payment-source.dto';
import { UpdatePaymentSourceDto } from './dto/update-payment-source.dto';

@Injectable()
export class PaymentSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreatePaymentSourceDto) {
    return this.prisma.paymentSource.create({ data: dto });
  }

  findAll() {
    return this.prisma.paymentSource.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const paymentSource = await this.prisma.paymentSource.findFirst({
      where: { id, deletedAt: null },
    });
    if (!paymentSource) {
      throw new NotFoundException(`Payment source ${id} not found`);
    }
    return paymentSource;
  }

  async update(id: string, dto: UpdatePaymentSourceDto) {
    await this.findOne(id);
    return this.prisma.paymentSource.update({ where: { id }, data: dto });
  }

  /** "Deactivate" — distinct from "Archive" (remove/soft-delete below): hides the
   *  source from new use without removing it. Reactivate via the generic update(). */
  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.paymentSource.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /** "Archive". */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.paymentSource.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
