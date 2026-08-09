import { CreateCustomerDto } from './create-customer.dto';

/**
 * Same shape as Create — `phone`/`email` double as the dedup key. At least
 * one of the two should be supplied for the lookup to be meaningful; not
 * enforced by a decorator since a customer with neither can still be
 * created (it just can never be matched by a later dedup lookup).
 */
export class FindOrCreateCustomerDto extends CreateCustomerDto {}
