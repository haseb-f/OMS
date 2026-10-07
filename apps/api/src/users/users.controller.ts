import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetUserPermissionsDto } from './dto/set-user-permissions.dto';
import { SetUserPermissionOverridesDto } from './dto/set-user-permission-overrides.dto';
import { PermissionAdministrationService } from '../permissions/permission-administration.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/**
 * User administration lives under the "Settings" permission module (Part 3
 * lists one "Settings" row, not a separate "Users" row) — every action here
 * requires `settings.manage`. Every mutation refuses agent users (S6: 409
 * AGENT_USER_MANAGED_IN_AGENTS) — they are administered in the agent
 * workspace (`/agents/:id/users`); the list shows internal users unless
 * `userType=AGENT|ALL` is requested.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('settings')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly permissionAdministration: PermissionAdministrationService,
  ) {}

  @Post()
  @PermissionAction('manage')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @PermissionAction('manage')
  findAll(
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('userType') userType?: string,
  ) {
    return this.usersService.findAll(
      search,
      departmentId,
      userType === 'AGENT' || userType === 'ALL' ? userType : 'INTERNAL',
    );
  }

  @Get(':id')
  @PermissionAction('manage')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @PermissionAction('manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.usersService.assertInternallyManaged(id);
    return this.usersService.update(id, dto, actor.sub);
  }

  @Delete(':id')
  @PermissionAction('manage')
  async remove(@Param('id') id: string) {
    await this.usersService.assertInternallyManaged(id);
    return this.usersService.remove(id);
  }

  @Post(':id/lock')
  @HttpCode(200)
  @PermissionAction('manage')
  async lock(@Param('id') id: string) {
    await this.usersService.assertInternallyManaged(id);
    return this.usersService.lock(id);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @PermissionAction('manage')
  async unlock(@Param('id') id: string) {
    await this.usersService.assertInternallyManaged(id);
    return this.usersService.unlock(id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @PermissionAction('manage')
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    await this.usersService.assertInternallyManaged(id);
    return this.usersService.resetPassword(id, dto ?? {});
  }

  @Post(':id/force-password-change')
  @HttpCode(200)
  @PermissionAction('manage')
  async forcePasswordChange(@Param('id') id: string) {
    await this.usersService.assertInternallyManaged(id);
    return this.usersService.forcePasswordChange(id);
  }

  @Get(':id/permissions')
  @PermissionAction('manage')
  getPermissions(@Param('id') id: string) {
    return this.usersService.getPermissions(id);
  }

  /** Legacy full-list save — R14: needs `users.manage_permissions`, escalation-checked and audited. */
  @Post(':id/permissions')
  @HttpCode(200)
  @PermissionAction('manage_permissions')
  async setPermissions(
    @Param('id') id: string,
    @Body() dto: SetUserPermissionsDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.usersService.assertInternallyManaged(id);
    return this.usersService.setPermissions(id, dto, actor.sub);
  }

  /** "Copy Permissions From" (Part 9) — user-to-user only. */
  @Post(':id/permissions/copy-from/:sourceUserId')
  @HttpCode(200)
  @PermissionAction('manage_permissions')
  async copyPermissionsFrom(
    @Param('id') id: string,
    @Param('sourceUserId') sourceUserId: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.usersService.assertInternallyManaged(id);
    await this.usersService.assertInternallyManaged(sourceUserId);
    return this.usersService.copyPermissionsFrom(id, sourceUserId, actor.sub);
  }

  /**
   * R14 W2 (spec-2 §A) — the permission panel: inherited template, individual
   * GRANT / DENY overrides and the resolver's effective set.
   */
  @Get(':id/permission-overrides')
  @PermissionAction('manage')
  async getPermissionOverrides(@Param('id') id: string) {
    await this.usersService.assertInternallyManaged(id);
    return this.permissionAdministration.getUserPanel(id);
  }

  /** Tri-state save; clears the review flag. 403 PERMISSION_ESCALATION on self-edit or a permission the actor lacks. */
  @Put(':id/permission-overrides')
  @PermissionAction('manage_permissions')
  async setPermissionOverrides(
    @Param('id') id: string,
    @Body() dto: SetUserPermissionOverridesDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.usersService.assertInternallyManaged(id);
    return this.permissionAdministration.setUserOverrides(actor.sub, id, dto);
  }
}
