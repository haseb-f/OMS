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
import { TransactionTypesService } from './transaction-types.service';
import { CreateTransactionTypeDto } from './dto/create-transaction-type.dto';
import { UpdateTransactionTypeDto } from './dto/update-transaction-type.dto';
import { FindTransactionTypesQueryDto } from './dto/find-transaction-types-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Master Data — Transaction Types Registry. Business operations: Create, Update, Archive, Restore, Search — the الوارد/الصادر split is the `direction` query filter, never two separate endpoints. */
@Controller('transaction-types')
@UseGuards(JwtAuthGuard)
export class TransactionTypesController {
  constructor(
    private readonly transactionTypesService: TransactionTypesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateTransactionTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactionTypesService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindTransactionTypesQueryDto) {
    return this.transactionTypesService.findAll(
      query,
      query.direction ? { direction: query.direction } : {},
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactionTypesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.transactionTypesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTransactionTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactionTypesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.transactionTypesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.transactionTypesService.restore(id, user.sub);
  }
}
