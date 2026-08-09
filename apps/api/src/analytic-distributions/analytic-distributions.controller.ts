import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AnalyticDistributionsService } from './analytic-distributions.service';
import { SetAnalyticDistributionsDto } from './dto/set-analytic-distributions.dto';
import { QueryAnalyticDistributionsDto } from './dto/query-analytic-distributions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Generic Analytic Distributions endpoint — one route pair for every document type (TASK-025 Part 2). */
@Controller('analytic-distributions')
@UseGuards(JwtAuthGuard)
export class AnalyticDistributionsController {
  constructor(
    private readonly analyticDistributionsService: AnalyticDistributionsService,
  ) {}

  @Get()
  findForDocument(@Query() query: QueryAnalyticDistributionsDto) {
    return this.analyticDistributionsService.getForDocument(
      query.documentType,
      query.documentId,
    );
  }

  @Put()
  setForDocument(
    @Body() dto: SetAnalyticDistributionsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analyticDistributionsService.setForDocument(
      dto.documentType,
      dto.documentId,
      dto.lines,
      user.sub,
    );
  }
}
