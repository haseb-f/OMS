import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JournalEntriesService } from '../journal-entries.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('journal-entries/:journalEntryId/activities')
@UseGuards(JwtAuthGuard)
export class JournalEntryActivitiesController {
  constructor(private readonly journalEntries: JournalEntriesService) {}

  @Get()
  findAll(@Param('journalEntryId') journalEntryId: string) {
    return this.journalEntries.activityFor(journalEntryId);
  }
}
