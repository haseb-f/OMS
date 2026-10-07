import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JobTitlesService } from './job-titles.service';
import { CreateJobTitleDto } from './dto/create-job-title.dto';
import { UpdateJobTitleDto } from './dto/update-job-title.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { SetJobTitlePermissionsDto } from './dto/set-job-title-permissions.dto';
import { PermissionAdministrationService } from '../permissions/permission-administration.service';

@Controller('job-titles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('job-titles')
export class JobTitlesController {
  constructor(
    private readonly jobTitlesService: JobTitlesService,
    private readonly permissionAdministration: PermissionAdministrationService,
  ) {}

  @Post()
  create(@Body() dto: CreateJobTitleDto, @CurrentUser() user: JwtPayload) {
    return this.jobTitlesService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.jobTitlesService.findAll(query);
  }

  /** Static route — must precede `:id`. Open read: the User/Employee form's Job Title picker needs this regardless of who holds `masterdata.job-titles.*`. */
  @Get('active')
  @SkipPermissionCheck()
  findActive() {
    return this.jobTitlesService.findActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobTitlesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.jobTitlesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJobTitleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.jobTitlesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.jobTitlesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.jobTitlesService.restore(id, user.sub);
  }

  /** R14 W2 (spec-2 §A) — the title's default permission template ("الصلاحيات الافتراضية"). */
  @Get(':id/permissions')
  @PermissionAction('view')
  permissionTemplate(@Param('id') id: string) {
    return this.permissionAdministration.getTemplate(id);
  }

  /** Impact preview: per holder gained / lost, and overrides that make a change ineffective. Writes nothing. */
  @Post(':id/permissions/preview')
  @HttpCode(200)
  @PermissionAction('manage_permissions')
  previewPermissionTemplate(
    @Param('id') id: string,
    @Body() dto: SetJobTitlePermissionsDto,
  ) {
    return this.permissionAdministration.previewTemplate(
      id,
      dto.permissionNames,
    );
  }

  /** Saves the template — applies live to every current holder. */
  @Put(':id/permissions')
  @PermissionAction('manage_permissions')
  setPermissionTemplate(
    @Param('id') id: string,
    @Body() dto: SetJobTitlePermissionsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.permissionAdministration.setTemplate(
      user.sub,
      id,
      dto.permissionNames,
    );
  }
}
