import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { NumberSeriesService } from './number-series.service';
import { NumberingEngineService } from './numbering-engine.service';
import { CreateNumberSeriesDto } from './dto/create-number-series.dto';
import { UpdateNumberSeriesDto } from './dto/update-number-series.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/**
 * Settings > Document Numbering (TASK-025 Part 5). "Only administrators can
 * modify numbering" is enforced the same way every permission in OMS is
 * enforced today — UI-side, via the `numbering.manage` permission seeded
 * only to the Administrator role (no controller in this codebase has an
 * API-level permission guard yet; this one is no exception, not a gap
 * introduced here).
 */
@Controller('number-series')
@UseGuards(JwtAuthGuard)
export class NumberingController {
  constructor(
    private readonly numberSeriesService: NumberSeriesService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  @Get()
  findAll() {
    return this.numberSeriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.numberSeriesService.findOne(id);
  }

  @Get(':id/preview')
  async preview(@Param('id') id: string) {
    const series = await this.numberSeriesService.findOne(id);
    return {
      preview: await this.numberingEngine.previewNext(series.documentType),
    };
  }

  @Post()
  create(@Body() dto: CreateNumberSeriesDto, @CurrentUser() user: JwtPayload) {
    return this.numberSeriesService.create(dto, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNumberSeriesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.numberSeriesService.update(id, dto, user.sub);
  }
}
