import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InvestorLedgerModule } from '../investor-ledger/investor-ledger.module';
import { investorPortalJwtServiceProvider } from './investor-portal-jwt.provider';
import { InvestorPortalAuthGuard } from './investor-portal-auth.guard';
import { InvestorPortalAuthService } from './investor-portal-auth.service';
import { InvestorPortalAuthController } from './investor-portal-auth.controller';
import { InvestorPortalService } from './investor-portal.service';
import { InvestorPortalController } from './investor-portal.controller';
import { InvestorPortalAdminService } from './investor-portal-admin.service';
import { InvestorPortalAdminController } from './investor-portal-admin.controller';

@Module({
  imports: [PrismaModule, InvestorLedgerModule],
  controllers: [
    InvestorPortalAuthController,
    InvestorPortalController,
    InvestorPortalAdminController,
  ],
  providers: [
    investorPortalJwtServiceProvider,
    InvestorPortalAuthGuard,
    InvestorPortalAuthService,
    InvestorPortalService,
    InvestorPortalAdminService,
  ],
})
export class InvestorPortalModule {}
