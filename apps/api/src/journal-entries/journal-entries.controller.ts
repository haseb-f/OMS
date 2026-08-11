import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryTemplatesService } from './journal-entry-templates.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { FindJournalEntriesQueryDto } from './dto/find-journal-entries-query.dto';
import { SaveJournalEntryTemplateDto } from './dto/save-journal-entry-template.dto';
import { BulkIdsDto } from '../master-data/dto/bulk-ids.dto';

/** Business operations only: Create, Update, Delete, Post, Reverse, Archive, Search, Templates. */
@Controller('journal-entries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('journal-entries')
export class JournalEntriesController {
  constructor(
    private readonly journalEntries: JournalEntriesService,
    private readonly templates: JournalEntryTemplatesService,
  ) {}

  @Post()
  create(@Body() dto: CreateJournalEntryDto, @CurrentUser() user: JwtPayload) {
    return this.journalEntries.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindJournalEntriesQueryDto) {
    return this.journalEntries.findAll(query);
  }

  /** "Select all matching filters" (Part 8) — bare IDs only, same filter/search as `findAll`. Registered before `:id` for the same reason `templates` is below. */
  @Get('ids')
  findAllIds(@Query() query: FindJournalEntriesQueryDto) {
    return this.journalEntries.findAllIds(query);
  }

  /** "Recurring Journal Templates" — registered before `:id` so `templates` is never swallowed by the id route. */
  @Get('templates')
  findAllTemplates() {
    return this.templates.findAll();
  }

  @Post('templates')
  saveTemplate(
    @Body() dto: SaveJournalEntryTemplateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.templates.save(dto, user.sub);
  }

  @Delete('templates/:id')
  @HttpCode(200)
  removeTemplate(@Param('id') id: string) {
    return this.templates.remove(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.journalEntries.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJournalEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.journalEntries.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.journalEntries.remove(id);
  }

  @Post(':id/post')
  @HttpCode(200)
  @PermissionAction('post')
  post(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.journalEntries.post(id, user.sub);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @PermissionAction('reverse')
  reverse(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.journalEntries.reverse(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.journalEntries.archive(id, user.sub);
  }

  @Post('bulk-archive')
  @HttpCode(200)
  @PermissionAction('delete')
  bulkArchive(@Body() dto: BulkIdsDto, @CurrentUser() user: JwtPayload) {
    return this.journalEntries.archiveMany(dto.ids, user.sub);
  }

  @Post(':id/duplicate')
  @HttpCode(200)
  duplicate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.journalEntries.duplicate(id, user.sub);
  }
}
