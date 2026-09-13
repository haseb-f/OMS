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
import { ProductBrandsService } from './product-brands.service';
import { CreateProductBrandDto } from './dto/create-product-brand.dto';
import { UpdateProductBrandDto } from './dto/update-product-brand.dto';
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

/** Master Data — Brands. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('product-brands')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('brands')
export class ProductBrandsController {
  constructor(private readonly productBrandsService: ProductBrandsService) {}

  @Post()
  create(@Body() dto: CreateProductBrandDto, @CurrentUser() user: JwtPayload) {
    return this.productBrandsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.productBrandsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productBrandsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.productBrandsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductBrandDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productBrandsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productBrandsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productBrandsService.restore(id, user.sub);
  }
}
