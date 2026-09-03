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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { LeadsService } from '../leads.service';

@Controller('leads/:leadId/notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('leads')
export class LeadNotesController {
  constructor(
    private readonly leadNotesService: LeadNotesService,
    private readonly leadsService: LeadsService,
    private readonly salesScope: SalesScopeService,
  ) {}

  private async assertScope(leadId: string, userId: string) {
    const scope = await this.salesScope.resolve(userId);
    await this.leadsService.findOne(leadId, scope);
  }

  @Post()
  async create(
    @Param('leadId') leadId: string,
    @Body() dto: CreateLeadNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertScope(leadId, user.sub);
    return this.leadNotesService.create(leadId, dto);
  }

  @Get()
  async findAll(
    @Param('leadId') leadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertScope(leadId, user.sub);
    return this.leadNotesService.findAllForLead(leadId);
  }

  @Get(':id')
  async findOne(
    @Param('leadId') leadId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertScope(leadId, user.sub);
    return this.leadNotesService.findOne(leadId, id);
  }

  @Patch(':id')
  async update(
    @Param('leadId') leadId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertScope(leadId, user.sub);
    return this.leadNotesService.update(leadId, id, dto);
  }

  @Delete(':id')
  async remove(
    @Param('leadId') leadId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertScope(leadId, user.sub);
    return this.leadNotesService.remove(leadId, id);
  }
}
