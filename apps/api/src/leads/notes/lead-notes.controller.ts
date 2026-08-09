import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { LeadNotesService } from './lead-notes.service';
import { CreateLeadNoteDto } from './dto/create-lead-note.dto';
import { UpdateLeadNoteDto } from './dto/update-lead-note.dto';

@Controller('leads/:leadId/notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('leads')
export class LeadNotesController {
  constructor(private readonly leadNotesService: LeadNotesService) {}

  @Post()
  create(@Param('leadId') leadId: string, @Body() dto: CreateLeadNoteDto) {
    return this.leadNotesService.create(leadId, dto);
  }

  @Get()
  findAll(@Param('leadId') leadId: string) {
    return this.leadNotesService.findAllForLead(leadId);
  }

  @Get(':id')
  findOne(@Param('leadId') leadId: string, @Param('id') id: string) {
    return this.leadNotesService.findOne(leadId, id);
  }

  @Patch(':id')
  update(
    @Param('leadId') leadId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadNoteDto,
  ) {
    return this.leadNotesService.update(leadId, id, dto);
  }

  @Delete(':id')
  remove(@Param('leadId') leadId: string, @Param('id') id: string) {
    return this.leadNotesService.remove(leadId, id);
  }
}
