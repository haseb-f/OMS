import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { canViewInventoryCost } from '../inventory/inventory-cost-access';
import {
  CreateRecipeDto,
  KitAvailabilityQueryDto,
  RecipeCostEstimateQueryDto,
} from './dto/recipe.dto';
import { RecipeManagementService } from './recipe-management.service';
import { RecipeInsightsService } from './recipe-insights.service';

/** A product's recipe versions and recipe-derived figures. Reads: `products.view`; creating a version: `products.recipes.manage`. */
@Controller('products/:productId')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('product-recipes')
export class ProductRecipesController {
  constructor(
    private readonly management: RecipeManagementService,
    private readonly insights: RecipeInsightsService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  @Get('recipes')
  list(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.management.list(productId);
  }

  @Post('recipes')
  @PermissionAction('manage')
  create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateRecipeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.management.create(productId, dto, user.sub);
  }

  /** Costs are withheld from callers without a costing permission (same rule as the stock cards). */
  @Get('recipe-cost-estimate')
  async costEstimate(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: RecipeCostEstimateQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.insights.costEstimate(productId, {
      recipeId: query.recipeId,
      includeCosts: await canViewInventoryCost(this.permissions, user.sub),
    });
  }

  @Get('kit-availability')
  availability(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: KitAvailabilityQueryDto,
  ) {
    return this.insights.availability(productId, query.warehouseId);
  }
}
