import { Global, Module } from '@nestjs/common';
import { SalesScopeService } from './sales-scope.service';

@Global()
@Module({
  providers: [SalesScopeService],
  exports: [SalesScopeService],
})
export class SalesScopeModule {}
