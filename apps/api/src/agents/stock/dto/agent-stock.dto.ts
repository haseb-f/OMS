import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';
import { AgentPortalPageQueryDto } from '../../portal/dto/agent-portal.dto';

export const AGENT_STOCK_RECEIPT_KINDS = ['OPENING', 'RECEIPT'] as const;
export type AgentStockReceiptKindValue =
  (typeof AGENT_STOCK_RECEIPT_KINDS)[number];

export class AgentStockReceiptLineDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * R18 B — custody receipt of agent-owned goods: quantities only. There is
 * deliberately no cost / price / supplier / invoice field — agent goods are
 * non-valued consignment stock.
 */
export class CreateAgentStockReceiptDto {
  @IsUUID()
  agentId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsIn(AGENT_STOCK_RECEIPT_KINDS)
  kind!: AgentStockReceiptKindValue;

  /** Business day received (YYYY-MM-DD, Cairo); default today, never in the future. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'receiptDate must be YYYY-MM-DD' })
  receiptDate?: string;

  /** The agent's own document (delivery note, waybill…). */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AgentStockReceiptLineDto)
  lines!: AgentStockReceiptLineDto[];
}

export class FindAgentStockReceiptsQueryDto extends AgentPortalPageQueryDto {
  @IsOptionalUuid()
  agentId?: string;

  /** One receipt (the link of a movement's source document). */
  @IsOptionalUuid()
  receiptId?: string;

  /** Receipt number or the agent's reference. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AgentStockMovementsQueryDto extends AgentPortalPageQueryDto {
  @IsOptionalUuid()
  productId?: string;
}
