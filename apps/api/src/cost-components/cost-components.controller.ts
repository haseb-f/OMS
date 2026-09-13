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
import { CostComponentsService } from './cost-components.service';
import { CreateCostComponentDto } from './dto/create-cost-component.dto';
import { UpdateCostComponentDto } from './dto/update-cost-component.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';

@Controller('cost-components')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('cost-engine')
export class CostComponentsController {
  constructor(private readonly costComponentsService: CostComponentsService) {}

  @Post()
  @PermissionAction('manage')
  create(@Body() dto: CreateCostComponentDto) {
    return this.costComponentsService.create(dto);
  }

  @Get()
  findAll() {
    return this.costComponentsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.costComponentsService.findOne(id);
  }

  @Patch(':id')
  @PermissionAction('manage')
  update(@Param('id') id: string, @Body() dto: UpdateCostComponentDto) {
    return this.costComponentsService.update(id, dto);
  }

  @Delete(':id')
  @PermissionAction('manage')
  remove(@Param('id') id: string) {
    return this.costComponentsService.remove(id);
  }
}
