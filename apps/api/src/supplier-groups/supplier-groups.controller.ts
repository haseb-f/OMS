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
import { SupplierGroupsService } from './supplier-groups.service';
import { CreateSupplierGroupDto } from './dto/create-supplier-group.dto';
import { UpdateSupplierGroupDto } from './dto/update-supplier-group.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Master Data — Supplier Groups. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('supplier-groups')
@UseGuards(JwtAuthGuard)
export class SupplierGroupsController {
  constructor(private readonly supplierGroupsService: SupplierGroupsService) {}

  @Post()
  create(@Body() dto: CreateSupplierGroupDto, @CurrentUser() user: JwtPayload) {
    return this.supplierGroupsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.supplierGroupsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.supplierGroupsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.supplierGroupsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierGroupDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.supplierGroupsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.supplierGroupsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.supplierGroupsService.restore(id, user.sub);
  }
}
