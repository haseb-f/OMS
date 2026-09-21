import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxRevaluationService } from './fx-revaluation.service';
import {
  CheckExchangeRateQueryDto,
  CreateExchangeRateDto,
  ExchangeRateQueryDto,
  RunFxRevaluationDto,
} from './dto/fx.dto';

@Controller('exchange-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  @Post()
  create(@Body() dto: CreateExchangeRateDto, @CurrentUser() user: JwtPayload) {
    return this.exchangeRates.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: ExchangeRateQueryDto) {
    return this.exchangeRates.findAll(query);
  }

  /** Read-only "is a rate on record?" probe used before posting any
   *  foreign-currency document — open to every signed-in user who can post
   *  documents, not only exchange-rate administrators. */
  @Get('check')
  @SkipPermissionCheck()
  check(@Query() query: CheckExchangeRateQueryDto) {
    return this.exchangeRates.checkRate(
      query.currencyId,
      query.asOf ? new Date(query.asOf) : new Date(),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.exchangeRates.findOne(id);
  }
}

@Controller('fx-revaluations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fx-revaluations')
export class FxRevaluationsController {
  constructor(private readonly fxRevaluation: FxRevaluationService) {}

  @Get()
  findAll() {
    return this.fxRevaluation.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fxRevaluation.findOne(id);
  }

  @Post('run')
  @PermissionAction('post')
  run(@Body() dto: RunFxRevaluationDto, @CurrentUser() user: JwtPayload) {
    return this.fxRevaluation.run(dto, user.sub);
  }
}
