import { CreateSupplierDto } from './create-supplier.dto';

/**
 * Same shape as Create — `phone`/`email` double as the dedup key, mirroring
 * `FindOrCreateCustomerDto`. `code` stays optional here too (see
 * `CreateSupplierDto.code`): a Quick-Create caller never needs to invent one.
 */
export class FindOrCreateSupplierDto extends CreateSupplierDto {}
