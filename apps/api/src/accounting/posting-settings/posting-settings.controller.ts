import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PostingSettingsService } from './posting-settings.service';
import { UpdatePostingSettingsDto } from './dto/update-posting-settings.dto';

@Controller('accounting/posting-settings')
@UseGuards(JwtAuthGuard)
export class PostingSettingsController {
  constructor(
    private readonly postingSettingsService: PostingSettingsService,
  ) {}

  @Get()
  get() {
    return this.postingSettingsService.get();
  }

  @Patch()
  update(
    @Body() dto: UpdatePostingSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.postingSettingsService.update(dto, user.sub);
  }
}
