import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { canViewAssemblyCost } from '../inventory/inventory-cost-access';
import { AssemblyService } from './assembly.service';
import {
  AssemblyPreviewQueryDto,
  CreateAssemblyDto,
  ListAssemblyQueryDto,
  ReverseAssemblyDto,
} from './dto/assembly.dto';

/** Immediate assembly of ASSEMBLED products: reads `inventory.view`, `inventory.assembly.create` / `.reverse` to act. */
@Controller('assembly')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('assembly')
export class AssemblyController {
  constructor(
    private readonly assembly: AssemblyService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /** Costs: inventory-cost visibility or the assembly direct-cost right (`canViewAssemblyCost`). */
  private canSeeCost(user: JwtPayload): Promise<boolean> {
    return canViewAssemblyCost(this.permissions, user.sub);
  }

  @Get('preview')
  async preview(
    @Query() query: AssemblyPreviewQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assembly.preview(query, await this.canSeeCost(user));
  }

  @Get()
  async findAll(
    @Query() query: ListAssemblyQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assembly.findAll(query, await this.canSeeCost(user));
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assembly.findOne(id, await this.canSeeCost(user));
  }

  /** 201 for a new order; 200 with the original order when the idempotency key was already used. */
  @Post()
  async create(
    @Body() dto: CreateAssemblyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { order, replayed } = await this.assembly.create(dto, user.sub, {
      idempotencyKey,
      includeCosts: await this.canSeeCost(user),
    });
    if (replayed) response.status(HttpStatus.OK);
    return order;
  }

  @Post(':id/reverse')
  @PermissionAction('reverse')
  async reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseAssemblyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assembly.reverse(
      id,
      dto,
      user.sub,
      await this.canSeeCost(user),
    );
  }
}
