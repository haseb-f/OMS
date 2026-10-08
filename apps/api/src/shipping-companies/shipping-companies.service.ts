import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, ShippingCompany } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import type { CreateShippingCompanyDto } from './dto/create-shipping-company.dto';
import type { UpdateShippingCompanyDto } from './dto/update-shipping-company.dto';

@Injectable()
export class ShippingCompaniesService extends MasterDataCrudService<ShippingCompany> {
  protected readonly entityType = 'SHIPPING_COMPANY';
  protected readonly entityLabel = 'Shipping Company';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ShippingCompany> {
    return this.prisma
      .shippingCompany as unknown as MasterDataDelegate<ShippingCompany>;
  }

  async create(
    dto: CreateShippingCompanyDto,
    userId?: string,
  ): Promise<ShippingCompany> {
    await this.assertCodPaymentMethod(dto.codPaymentMethodId);
    return super.create(dto, userId);
  }

  async update(
    id: string,
    dto: UpdateShippingCompanyDto,
    userId?: string,
  ): Promise<ShippingCompany> {
    await this.assertCodPaymentMethod(dto.codPaymentMethodId);
    return super.update(id, dto, userId);
  }

  /**
   * R15 (D15-9) — a carrier's COD collection method must be an active,
   * reconciled payment method with a clearing account: a postable ASSET
   * account = "receivable from the carrier". The carrier's COD report is that
   * method's provider statement (file, sheet or manual line) — matching it
   * posts the receipt (Dr clearing / Cr AR) — and the carrier's remittance is
   * its settlement (Dr bank + fee / Cr clearing), both in the method's
   * reconciliation workspace. A non-reconciled method's account is the bank
   * itself, which would book cash the carrier still holds.
   */
  private async assertCodPaymentMethod(methodId: string | null | undefined) {
    if (!methodId) return;
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, deletedAt: null },
      select: {
        name: true,
        isActive: true,
        requiresReconciliation: true,
        account: {
          select: {
            code: true,
            name: true,
            accountType: true,
            allowsPosting: true,
            deletedAt: true,
          },
        },
      },
    });
    const invalid = (reasonAr: string, reasonEn: string) =>
      new BadRequestException({
        code: 'COD_PAYMENT_METHOD_INVALID',
        message: `${reasonAr} — ${reasonEn}`,
        fields: [{ field: 'codPaymentMethodId', constraints: ['invalid'] }],
      });
    if (!method || !method.isActive) {
      throw invalid(
        'طريقة الدفع غير موجودة أو غير نشطة',
        'The COD collection method was not found or is inactive.',
      );
    }
    if (!method.requiresReconciliation) {
      throw invalid(
        `طريقة الدفع "${method.name}" لا تتطلب مطابقة — اختر طريقة تحصيل بحساب تسوية تُطابق مع كشف شركة الشحن`,
        `Payment method "${method.name}" is not reconciled: choose a method that requires reconciliation, so the carrier's COD report is matched as its statement and the remittance settles its clearing account.`,
      );
    }
    const account = method.account;
    if (
      !account ||
      account.deletedAt ||
      !account.allowsPosting ||
      account.accountType !== AccountType.ASSET
    ) {
      throw invalid(
        `طريقة الدفع "${method.name}" ليس لها حساب تسوية (أصل قابل للترحيل)`,
        `Payment method "${method.name}" has no clearing account: link it to a postable ASSET account (receivable from the carrier) in Payment Methods first.`,
      );
    }
  }
}
