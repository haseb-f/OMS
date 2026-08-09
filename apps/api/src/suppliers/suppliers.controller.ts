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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { FindSuppliersQueryDto } from './dto/find-suppliers-query.dto';
import { FindOrCreateSupplierDto } from './dto/find-or-create-supplier.dto';

/** Business operations only: Create, Update, Archive, Activate, Search, Find-or-Create. */
@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Post('find-or-create')
  findOrCreate(@Body() dto: FindOrCreateSupplierDto) {
    return this.suppliersService.findOrCreate(dto);
  }

  @Get()
  findAll(@Query() query: FindSuppliersQueryDto) {
    return this.suppliersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string) {
    return this.suppliersService.archive(id);
  }

  @Post(':id/restore')
  @SkipPermissionCheck()
  restore(@Param('id') id: string) {
    return this.suppliersService.restore(id);
  }

  @Post(':id/activate')
  @SkipPermissionCheck()
  activate(@Param('id') id: string) {
    return this.suppliersService.activate(id);
  }
}
