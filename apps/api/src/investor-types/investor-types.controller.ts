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
import { InvestorTypesService } from './investor-types.service';
import { CreateInvestorTypeDto } from './dto/create-investor-type.dto';
import { UpdateInvestorTypeDto } from './dto/update-investor-type.dto';
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

/** Investor Settings — Investor Type Master Data. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('investor-types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investor-settings')
export class InvestorTypesController {
  constructor(private readonly investorTypesService: InvestorTypesService) {}

  @Post()
  create(@Body() dto: CreateInvestorTypeDto, @CurrentUser() user: JwtPayload) {
    return this.investorTypesService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.investorTypesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.investorTypesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.investorTypesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestorTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.investorTypesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.investorTypesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.investorTypesService.restore(id, user.sub);
  }
}
