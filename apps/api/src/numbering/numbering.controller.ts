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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/**
 * Settings > Document Numbering (TASK-025 Part 5). "Only administrators can
 * modify numbering" (TASK-062) is now enforced server-side via the existing
 * `numbering.manage` permission (already seeded, already checked by the
 * Document Numbering page), not just by which role the UI happens to show
 * the button to.
 */
@Controller('number-series')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('numbering')
export class NumberingController {
  constructor(
    private readonly numberSeriesService: NumberSeriesService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  @Get()
  @SkipPermissionCheck()
  findAll() {
    return this.numberSeriesService.findAll();
  }

  @Get(':id')
  @SkipPermissionCheck()
  findOne(@Param('id') id: string) {
    return this.numberSeriesService.findOne(id);
  }

  @Get(':id/preview')
  @SkipPermissionCheck()
  async preview(@Param('id') id: string) {
    const series = await this.numberSeriesService.findOne(id);
    return {
      preview: await this.numberingEngine.previewNext(series.documentType),
    };
  }

  @Post()
  @PermissionAction('manage')
  create(@Body() dto: CreateNumberSeriesDto, @CurrentUser() user: JwtPayload) {
    return this.numberSeriesService.create(dto, user.sub);
  }

  @Patch(':id')
  @PermissionAction('manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNumberSeriesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.numberSeriesService.update(id, dto, user.sub);
  }
}
