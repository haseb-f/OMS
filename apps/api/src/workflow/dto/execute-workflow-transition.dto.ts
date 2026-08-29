import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class ExecuteWorkflowTransitionDto {
  @IsUUID()
  transitionId!: string;

  @IsString()
  @IsOptional()
  reason?: string;

  /** LEAD_CONVERT payload */
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @IsString()
  @IsOptional()
  paymentType?: 'PREPAID' | 'CASH_ON_DELIVERY';

  @IsString()
  @IsOptional()
  notes?: string;
}

export class RequestWorkflowApprovalDto {
  @IsUUID()
  transitionId!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
