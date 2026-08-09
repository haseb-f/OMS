import { Module } from '@nestjs/common';
import { NumberingController } from './numbering.controller';
import { NumberSeriesService } from './number-series.service';
import { NumberingEngineService } from './numbering-engine.service';

/**
 * The Universal Numbering Engine (TASK-025 Part 4) — imported by every
 * module that mints a document number (Suppliers, Leads, Sales Orders,
 * Payments, Purchase Orders, Inventory Movements today; every future
 * module tomorrow) instead of each hand-rolling its own Postgres sequence.
 */
@Module({
  controllers: [NumberingController],
  providers: [NumberSeriesService, NumberingEngineService],
  exports: [NumberingEngineService, NumberSeriesService],
})
export class NumberingModule {}
