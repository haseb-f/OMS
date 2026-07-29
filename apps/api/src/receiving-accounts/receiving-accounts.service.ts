import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReceivingAccountDto } from './dto/create-receiving-account.dto';
import { UpdateReceivingAccountDto } from './dto/update-receiving-account.dto';

/** Administrator can: Create, Edit, Archive. (isActive is toggled via the generic edit.) */
@Injectable()
export class ReceivingAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateReceivingAccountDto) {
    return this.prisma.receivingAccount.create({ data: dto });
  }

  findAll() {
    return this.prisma.receivingAccount.findMany({
      where: { deletedAt: null },
    });
  }

  async findOne(id: string) {
    const receivingAccount = await this.prisma.receivingAccount.findFirst({
      where: { id, deletedAt: null },
    });
    if (!receivingAccount) {
      throw new NotFoundException(`Receiving account ${id} not found`);
    }
    return receivingAccount;
  }

  async update(id: string, dto: UpdateReceivingAccountDto) {
    await this.findOne(id);
    return this.prisma.receivingAccount.update({ where: { id }, data: dto });
  }

  /** "Archive". */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.receivingAccount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
