import { PartialType } from '@nestjs/mapped-types';
import { CreateTransactionTypeDto } from './create-transaction-type.dto';

/**
 * Every field is accepted here; `TransactionTypesService.update` is what
 * actually restricts a System Type to its safely-configurable subset
 * (isActive / defaultAccountId / defaultAccountingTreatment) and rejects
 * any attempt to change its semantic identity (code/direction/nature/
 * matchingTarget) — never enforced at the DTO layer, since a Custom Type
 * legitimately accepts all of these fields.
 */
export class UpdateTransactionTypeDto extends PartialType(
  CreateTransactionTypeDto,
) {}
