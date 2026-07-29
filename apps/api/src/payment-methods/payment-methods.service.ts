import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreatePaymentMethodDto) {
    return this.prisma.paymentMethod.create({ data: dto });
  }

  findAll() {
    return this.prisma.paymentMethod.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const paymentMethod = await this.prisma.paymentMethod.findFirst({
      where: { id, deletedAt: null },
    });
    if (!paymentMethod) {
      throw new NotFoundException(`Payment method ${id} not found`);
    }
    return paymentMethod;
  }

  async update(id: string, dto: UpdatePaymentMethodDto) {
    await this.findOne(id);
    return this.prisma.paymentMethod.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.paymentMethod.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
