import { Module } from '@nestjs/common';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { AccountMappingModule } from '../accounting/account-mapping/account-mapping.module';
import { AccountingReportsModule } from '../accounting/reports/accounting-reports.module';
import { CompanyPartnerPostingProvider } from '../accounting/posting-providers/company-partner-posting.provider';
import { PartnersModule } from '../partners/partners.module';
import { NumberingModule } from '../numbering/numbering.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { UsersModule } from '../users/users.module';
import {
  CompanyPartnerProfilesController,
  PartnerAgreementsController,
  PartnerLoginsController,
  PartnerPaymentsController,
  PartnerProfitPeriodsController,
} from './company-partners.controller';
import { CompanyPartnersService } from './company-partners.service';
import { PartnerBalancesService } from './partner-balances.service';
import { PartnerProfitService } from './partner-profit.service';
import { PartnerPaymentsService } from './partner-payments.service';
import { PartnerStatementService } from './partner-statement.service';
import { PartnerLoginsService } from './partner-logins.service';

/**
 * R14 W5 — company partners and profit sharing ("الشركاء", spec-5); R15 W4
 * adds the partner's own login (`PartnerLoginsService`). The
 * posting provider lives with the other providers
 * (`accounting/posting-providers`) and self-registers with the shared
 * PostingEngineService singleton on module init.
 */
@Module({
  imports: [
    PostingEngineModule,
    AccountMappingModule,
    AccountingReportsModule,
    PartnersModule,
    NumberingModule,
    MasterDataModule,
    UsersModule,
  ],
  controllers: [
    CompanyPartnerProfilesController,
    PartnerAgreementsController,
    PartnerProfitPeriodsController,
    PartnerPaymentsController,
    PartnerLoginsController,
  ],
  providers: [
    CompanyPartnerPostingProvider,
    CompanyPartnersService,
    PartnerBalancesService,
    PartnerProfitService,
    PartnerPaymentsService,
    PartnerStatementService,
    PartnerLoginsService,
  ],
  exports: [
    PartnerProfitService,
    // R15 — the partner portal reads the same statement, terms and payments.
    CompanyPartnersService,
    PartnerStatementService,
    PartnerPaymentsService,
  ],
})
export class CompanyPartnersModule {}
