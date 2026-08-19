import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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

/** User administration lives under the "Settings" permission module (Part 3 lists one "Settings" row, not a separate "Users" row) — every action here requires `settings.manage`. */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('settings')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @PermissionAction('manage')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @PermissionAction('manage')
  findAll(@Query('search') search?: string) {
    return this.usersService.findAll(search);
  }

  @Get(':id')
  @PermissionAction('manage')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @PermissionAction('manage')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @PermissionAction('manage')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post(':id/lock')
  @HttpCode(200)
  @PermissionAction('manage')
  lock(@Param('id') id: string) {
    return this.usersService.lock(id);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @PermissionAction('manage')
  unlock(@Param('id') id: string) {
    return this.usersService.unlock(id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @PermissionAction('manage')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto ?? {});
  }

  @Post(':id/force-password-change')
  @HttpCode(200)
  @PermissionAction('manage')
  forcePasswordChange(@Param('id') id: string) {
    return this.usersService.forcePasswordChange(id);
  }

  @Get(':id/permissions')
  @PermissionAction('manage')
  getPermissions(@Param('id') id: string) {
    return this.usersService.getPermissions(id);
  }

  @Post(':id/permissions')
  @HttpCode(200)
  @PermissionAction('manage')
  setPermissions(@Param('id') id: string, @Body() dto: SetUserPermissionsDto) {
    return this.usersService.setPermissions(id, dto);
  }

  /** "Copy Permissions From" (Part 9) — user-to-user only. */
  @Post(':id/permissions/copy-from/:sourceUserId')
  @HttpCode(200)
  @PermissionAction('manage')
  copyPermissionsFrom(
    @Param('id') id: string,
    @Param('sourceUserId') sourceUserId: string,
  ) {
    return this.usersService.copyPermissionsFrom(id, sourceUserId);
  }
}
