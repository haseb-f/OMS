import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReceivingAccountsService } from './receiving-accounts.service';
import { CreateReceivingAccountDto } from './dto/create-receiving-account.dto';
import { UpdateReceivingAccountDto } from './dto/update-receiving-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';

/** Administrator can: Create, Edit, Archive. */
@Controller('receiving-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('receiving-accounts')
export class ReceivingAccountsController {
  constructor(
    private readonly receivingAccountsService: ReceivingAccountsService,
  ) {}

  @Post()
  create(@Body() dto: CreateReceivingAccountDto) {
    return this.receivingAccountsService.create(dto);
  }

  @Get()
  @SkipPermissionCheck()
  findAll() {
    return this.receivingAccountsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.receivingAccountsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReceivingAccountDto) {
    return this.receivingAccountsService.update(id, dto);
  }

  @Delete(':id')
  @PermissionAction('delete')
  remove(@Param('id') id: string) {
    return this.receivingAccountsService.remove(id);
  }
}
