import { Controller, Get, Param } from '@nestjs/common';
import { SupplierActivityService } from './supplier-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('suppliers/:supplierId/activities')
export class SupplierActivitiesController {
  constructor(private readonly activityService: SupplierActivityService) {}

  @Get()
  findAll(@Param('supplierId') supplierId: string) {
    return this.activityService.findAllForSupplier(supplierId);
  }
}
