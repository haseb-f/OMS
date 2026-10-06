import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrepaidExpensesService } from './prepaid-expenses.service';
import {
  CancelPrepaidDto,
  CreatePrepaidExpenseDto,
  PrepaidPreviewDto,
  RecognizePrepaidDto,
  RecognizeRemainingDto,
  UpdatePrepaidExpenseDto,
} from './dto/prepaid-expense.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

@Controller('prepaid-expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('prepaid-expenses')
export class PrepaidExpensesController {
  constructor(private readonly prepaidExpenses: PrepaidExpensesService) {}

  @Post()
  create(
    @Body() dto: CreatePrepaidExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prepaidExpenses.create(dto, user.sub);
  }

  @Post('recognize')
  @PermissionAction('edit')
  recognize(@Body() dto: RecognizePrepaidDto, @CurrentUser() user: JwtPayload) {
    return this.prepaidExpenses.recognize(dto, user.sub);
  }

  /** Recognition schedule of an unsaved form (no side effects). */
  @Post('schedule-preview')
  @HttpCode(200)
  @PermissionAction('view')
  previewSchedule(@Body() dto: PrepaidPreviewDto) {
    return this.prepaidExpenses.previewSchedule(dto);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.prepaidExpenses.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prepaidExpenses.detail(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.prepaidExpenses.activityFor(id);
  }

  @Patch(':id')
  @PermissionAction('edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePrepaidExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prepaidExpenses.update(id, dto, user.sub);
  }

  @Post(':id/activate')
  @PermissionAction('edit')
  activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.prepaidExpenses.activate(id, user.sub);
  }

  /** R13b (O-3) — reclaim the unrecognized balance from the supplier and cancel. */
  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('edit')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelPrepaidDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prepaidExpenses.cancelWithRefund(id, dto, user.sub);
  }

  /** R13b (O-3) — expense the unrecognized balance now and complete. */
  @Post(':id/recognize-remaining')
  @HttpCode(200)
  @PermissionAction('edit')
  recognizeRemaining(
    @Param('id') id: string,
    @Body() dto: RecognizeRemainingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prepaidExpenses.recognizeRemaining(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.prepaidExpenses.archive(id, user.sub);
  }
}
