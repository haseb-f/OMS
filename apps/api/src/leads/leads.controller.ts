import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadAssignmentsService } from './assignments/lead-assignments.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ArchiveLeadDto } from './dto/archive-lead.dto';
import { CreateLeadAssignmentDto } from './assignments/dto/create-lead-assignment.dto';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }

  @Get()
  findAll() {
    return this.leadsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }

  // --- Business Operations (beside CRUD) ---

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: CreateLeadAssignmentDto) {
    return this.leadAssignmentsService.assign(id, dto);
  }

  @Post(':id/start-follow-up')
  @HttpCode(200)
  startFollowUp(@Param('id') id: string) {
    return this.leadsService.startFollowUp(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string, @Body() dto: ArchiveLeadDto) {
    return this.leadsService.archive(id, dto);
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(@Param('id') id: string) {
    return this.leadsService.markPaid(id);
  }
}
