import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JournalsService } from './journals.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { FindJournalsQueryDto } from './dto/find-journals-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Journal configuration (TASK-053). Business operations: Create, Update, Archive, Restore, Search. */
@Controller('journals')
@UseGuards(JwtAuthGuard)
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @Post()
  create(@Body() dto: CreateJournalDto, @CurrentUser() user: JwtPayload) {
    return this.journalsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindJournalsQueryDto) {
    return this.journalsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.journalsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.journalsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJournalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.journalsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.journalsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.journalsService.restore(id, user.sub);
  }
}
