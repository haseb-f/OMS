import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SupplierActivityService } from './supplier-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('suppliers/:supplierId/activities')
@UseGuards(JwtAuthGuard)
export class SupplierActivitiesController {
  constructor(private readonly activityService: SupplierActivityService) {}

  @Get()
  findAll(@Param('supplierId') supplierId: string) {
    return this.activityService.findAllForSupplier(supplierId);
  }
}
