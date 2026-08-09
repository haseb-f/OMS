import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { YearClosingService } from './year-closing.service';
import { CloseYearDto } from './dto/close-year.dto';

@Controller('accounting/year-closing')
@UseGuards(JwtAuthGuard)
export class YearClosingController {
  constructor(private readonly yearClosing: YearClosingService) {}

  @Post()
  execute(@Body() dto: CloseYearDto, @CurrentUser() user: JwtPayload) {
    return this.yearClosing.execute(dto, user.sub);
  }
}
