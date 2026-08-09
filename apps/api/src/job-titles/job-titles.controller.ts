import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { JobTitlesService } from './job-titles.service';

@Controller('job-titles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('settings')
export class JobTitlesController {
  constructor(private readonly jobTitlesService: JobTitlesService) {}

  @Get()
  @PermissionAction('manage')
  findAll() {
    return this.jobTitlesService.findAll();
  }
}
