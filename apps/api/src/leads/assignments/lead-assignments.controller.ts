import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { LeadAssignmentsService } from './lead-assignments.service';
import { CreateLeadAssignmentDto } from './dto/create-lead-assignment.dto';

/**
 * Append-only: reassigning a lead creates a new assignment record rather
 * than editing history, so there is no update/delete here.
 */
@Controller('leads/:leadId/assignments')
export class LeadAssignmentsController {
  constructor(
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  @Post()
  assign(
    @Param('leadId') leadId: string,
    @Body() dto: CreateLeadAssignmentDto,
  ) {
    return this.leadAssignmentsService.assign(leadId, dto);
  }

  @Get()
  findAll(@Param('leadId') leadId: string) {
    return this.leadAssignmentsService.findAllForLead(leadId);
  }
}
