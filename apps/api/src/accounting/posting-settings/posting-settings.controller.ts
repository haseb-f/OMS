import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PostingSettingsService } from './posting-settings.service';
import { UpdatePostingSettingsDto } from './dto/update-posting-settings.dto';

@Controller('accounting/posting-settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fiscal-configuration')
export class PostingSettingsController {
  constructor(
    private readonly postingSettingsService: PostingSettingsService,
  ) {}

  @Get()
  @SkipPermissionCheck()
  get() {
    return this.postingSettingsService.get();
  }

  @Patch()
  @PermissionAction('manage')
  update(
    @Body() dto: UpdatePostingSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.postingSettingsService.update(dto, user.sub);
  }
}
