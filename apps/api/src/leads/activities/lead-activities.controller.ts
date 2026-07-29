import { Controller, Get, Param } from '@nestjs/common';
import { LeadActivityService } from './lead-activity.service';

/**
 * Read-only: activities are system-generated timeline entries, never
 * created directly by a client.
 */
@Controller('leads/:leadId/activities')
export class LeadActivitiesController {
  constructor(private readonly leadActivityService: LeadActivityService) {}

  @Get()
  findAll(@Param('leadId') leadId: string) {
    return this.leadActivityService.findAllForLead(leadId);
  }
}
