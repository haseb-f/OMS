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
import { WorkflowType } from '@prisma/client';
import { StatusDefinitionsService } from './status-definitions.service';
import { CreateStatusDefinitionDto } from './dto/create-status-definition.dto';
import { UpdateStatusDefinitionDto } from './dto/update-status-definition.dto';
import { FindStatusDefinitionsQueryDto } from './dto/find-status-definitions-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

@Controller('status-definitions')
@UseGuards(JwtAuthGuard)
export class StatusDefinitionsController {
  constructor(private readonly service: StatusDefinitionsService) {}

  @Post()
  create(
    @Body() dto: CreateStatusDefinitionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindStatusDefinitionsQueryDto) {
    return this.service.findAll(query);
  }

  @Get('by-workflow/:workflowType')
  findByWorkflow(@Param('workflowType') workflowType: WorkflowType) {
    return this.service.findByWorkflow(workflowType);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.service.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDefinitionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.restore(id, user.sub);
  }
}
