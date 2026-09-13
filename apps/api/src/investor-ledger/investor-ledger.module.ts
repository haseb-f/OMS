import { Module } from '@nestjs/common';
import { InvestorLedgerController } from './investor-ledger.controller';
import { InvestorLedgerService } from './investor-ledger.service';

/**
 * Investor Engine Milestone 3 — deliberately depends on nothing but Prisma
 * (same "leaf module" shape as AccountMappingModule) so every other
 * Milestone 3 module (Capital Contributions, Distributions, Payments,
 * Capital Returns) can import it without creating a cycle.
 */
@Module({
  controllers: [InvestorLedgerController],
  providers: [InvestorLedgerService],
  exports: [InvestorLedgerService],
})
export class InvestorLedgerModule {}
