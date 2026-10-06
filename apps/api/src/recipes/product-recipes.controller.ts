import {
  Body,
  Controller,
  ForbiddenException,
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
import {
  canViewAssemblyCost,
  canViewInventoryCost,
} from '../inventory/inventory-cost-access';
import {
  CreateRecipeDto,
  KitAvailabilityQueryDto,
  RecipeCostEstimateQueryDto,
} from './dto/recipe.dto';
import {
  RecipeManagementService,
  withRecipeCostRule,
} from './recipe-management.service';
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

  /** The direct-cost estimate is withheld without assembly-cost visibility. */
  @Get('recipes')
  async list(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const [views, includeCosts] = await Promise.all([
      this.management.list(productId),
      canViewAssemblyCost(this.permissions, user.sub),
    ]);
    return withRecipeCostRule(views, includeCosts);
  }

  @Post('recipes')
  @PermissionAction('manage')
  async create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateRecipeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return withRecipeCostRule(
      await this.management.create(productId, dto, user.sub),
      await canViewAssemblyCost(this.permissions, user.sub),
    );
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

  /** Per-component stock figures: `products.view` (module) AND `inventory.view` — 403 otherwise. */
  @Get('kit-availability')
  async availability(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: KitAvailabilityQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!(await this.permissions.hasPermission(user.sub, 'inventory.view'))) {
      throw new ForbiddenException({
        code: 'INVENTORY_VIEW_REQUIRED',
        message:
          'Kit availability shows component stock — it needs the inventory.view permission.',
      });
    }
    return this.insights.availability(productId, query.warehouseId);
  }
}
