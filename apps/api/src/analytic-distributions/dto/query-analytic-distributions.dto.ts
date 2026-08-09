import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class QueryAnalyticDistributionsDto {
  @IsString()
  @IsNotEmpty()
  documentType!: string;

  @IsUUID()
  @IsNotEmpty()
  documentId!: string;
}
