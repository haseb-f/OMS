import { Module } from '@nestjs/common';
import { CompanyPartnersModule } from '../company-partners/company-partners.module';
import { PartnerPortalController } from './partner-portal.controller';
import { PartnerPortalService } from './partner-portal.service';
import { PartnerPermissionGuard } from './partner-permission.guard';

/** R15 (D15-14) — a company partner's own view: `/partner-portal/*`. */
@Module({
  imports: [CompanyPartnersModule],
  controllers: [PartnerPortalController],
  providers: [PartnerPortalService, PartnerPermissionGuard],
})
export class PartnerPortalModule {}
