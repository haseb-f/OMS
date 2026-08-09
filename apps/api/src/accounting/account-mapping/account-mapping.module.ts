import { Module } from '@nestjs/common';
import { AccountMappingService } from './account-mapping.service';

/**
 * TASK-047 — deliberately depends on nothing but Prisma. Every posting
 * provider that needs an account id imports this module instead of reading
 * `PostingSettings`/`ProductCategory`/`CustomerGroup`/`SupplierGroup`/`Tax`
 * account columns itself.
 */
@Module({
  providers: [AccountMappingService],
  exports: [AccountMappingService],
})
export class AccountMappingModule {}
