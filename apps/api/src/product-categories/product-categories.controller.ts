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
import { ProductCategoriesService } from './product-categories.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
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

/** Master Data — Categories. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('product-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('categories')
export class ProductCategoriesController {
  constructor(
    private readonly productCategoriesService: ProductCategoriesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateProductCategoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productCategoriesService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.productCategoriesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productCategoriesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.productCategoriesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductCategoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productCategoriesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productCategoriesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productCategoriesService.restore(id, user.sub);
  }
}
