import { Global, Module } from '@nestjs/common';
import { PhoneNumberService } from './phone-number.service';

/**
 * Makes `PhoneNumberService` resolvable from any module without every
 * consumer (Leads, Customers, Suppliers, Users, Import Center, ...)
 * importing this one — mirrors `PermissionsCoreModule`. Imported exactly
 * once, in `AppModule`.
 */
@Global()
@Module({
  providers: [PhoneNumberService],
  exports: [PhoneNumberService],
})
export class PhoneModule {}
