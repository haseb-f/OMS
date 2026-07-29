import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CostComponentsService } from './cost-components.service';
import { CreateCostComponentDto } from './dto/create-cost-component.dto';
import { UpdateCostComponentDto } from './dto/update-cost-component.dto';

@Controller('cost-components')
export class CostComponentsController {
  constructor(private readonly costComponentsService: CostComponentsService) {}

  @Post()
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
  update(@Param('id') id: string, @Body() dto: UpdateCostComponentDto) {
    return this.costComponentsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.costComponentsService.remove(id);
  }
}
