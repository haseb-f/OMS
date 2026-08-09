import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PhysicalCountService } from './physical-count.service';
import { CreatePhysicalCountDto } from './dto/create-physical-count.dto';
import { UpdateCountLineDto } from './dto/update-count-line.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

@Controller('physical-counts')
@UseGuards(JwtAuthGuard)
export class PhysicalCountController {
  constructor(private readonly physicalCountService: PhysicalCountService) {}

  @Post()
  create(@Body() dto: CreatePhysicalCountDto, @CurrentUser() user: JwtPayload) {
    return this.physicalCountService.create(dto, user.sub);
  }

  @Get()
  findAll() {
    return this.physicalCountService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.physicalCountService.findOne(id);
  }

  @Patch(':id/lines/:lineId')
  updateLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateCountLineDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.physicalCountService.updateLine(id, lineId, dto, user.sub);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.physicalCountService.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.physicalCountService.cancel(id, user.sub);
  }
}
