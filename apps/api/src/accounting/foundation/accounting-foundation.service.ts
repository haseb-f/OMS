import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { activateAccountingFoundation } from './accounting-foundation.bootstrap';

@Injectable()
export class AccountingFoundationService {
  constructor(private readonly prisma: PrismaService) {}

  activate(userId?: string) {
    return activateAccountingFoundation(this.prisma, userId);
  }
}
