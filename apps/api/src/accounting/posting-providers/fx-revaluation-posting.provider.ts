import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { FxRevaluationService } from '../fx/fx-revaluation.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

@Injectable()
export class FxRevaluationPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['FX_REVALUATION'];

  constructor(
    private readonly postingEngine: PostingEngineService,
    private readonly fxRevaluation: FxRevaluationService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const built = await this.fxRevaluation.buildRevaluationLines(sourceId, tx);
    if (!built) return null;
    return {
      lines: built.lines,
      description: `FX revaluation ${built.runNumber}`,
      referenceNumber: built.runNumber,
      entryDate: built.rateDate,
    };
  }
}
