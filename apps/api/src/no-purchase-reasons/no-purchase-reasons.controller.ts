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
import { NoPurchaseReasonsService } from './no-purchase-reasons.service';
import { CreateNoPurchaseReasonDto } from './dto/create-no-purchase-reason.dto';
import { UpdateNoPurchaseReasonDto } from './dto/update-no-purchase-reason.dto';
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

@Controller('no-purchase-reasons')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('no-purchase-reasons')
export class NoPurchaseReasonsController {
  constructor(
    private readonly noPurchaseReasonsService: NoPurchaseReasonsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateNoPurchaseReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.noPurchaseReasonsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.noPurchaseReasonsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.noPurchaseReasonsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.noPurchaseReasonsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNoPurchaseReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.noPurchaseReasonsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.noPurchaseReasonsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.noPurchaseReasonsService.restore(id, user.sub);
  }
}
