import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierActivitiesController } from './activities/supplier-activities.controller';
import { SupplierActivityService } from './activities/supplier-activity.service';

@Module({
  controllers: [SuppliersController, SupplierActivitiesController],
  providers: [SuppliersService, SupplierActivityService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
