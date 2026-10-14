import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { assertCounterAccount } from './counter-accounts';
import {
  assertMoneyAccountCurrency,
  assertTransferCurrency,
  loadMoneyAccount,
  resolveTransferLegs,
  type MoneyAccount,
} from './money-accounts';
import {
  counterDirectionOf,
  type OtherVoucherType,
} from './other-voucher-types';

type Reader = Pick<
  Prisma.TransactionClient,
  | 'chartOfAccount'
  | 'receivingAccount'
  | 'postingSettings'
  | 'customerProfile'
  | 'customerGroup'
  | 'supplierProfile'
  | 'supplierGroup'
  | 'paymentMethod'
  | 'tax'
  | 'productCategory'
  | 'payrollComponent'
>;

/** The voucher fields the D4 rules read (stored row or merged draft edit). */
export interface OtherVoucherState {
  counterAccountId?: string | null;
  receivingAccountId?: string | null;
  targetReceivingAccountId?: string | null;
  /** undefined = not chosen yet (taken from the cash / bank account). */
  currencyId?: string | null;
}

export interface ResolvedOtherVoucher {
  /** The currency to store (null = functional). */
  currencyId: string | null;
  /** OTHER_*: the cash / bank account (null on a draft that has none yet). */
  money: MoneyAccount | null;
  /** INTERNAL_TRANSFER: destination / source. */
  target: MoneyAccount | null;
}

/**
 * R22 (D4) — the one rule set of the three voucher types, run at create,
 * update and confirm by `OtherVouchersService` and again by the posting
 * provider inside the posting transaction:
 *  - other receipt / payment: an allowed counter-account for the direction
 *    (`assertCounterAccount`), an active cash / bank account (required to
 *    post) whose currency the voucher shares;
 *  - internal transfer: two different active cash / bank accounts in one
 *    currency (422 TRANSFER_CROSS_CURRENCY otherwise), the voucher in it.
 */
export async function resolveOtherVoucher(
  client: Reader,
  type: OtherVoucherType,
  state: OtherVoucherState,
  options: { forPosting?: boolean } = {},
): Promise<ResolvedOtherVoucher> {
  if (type === 'INTERNAL_TRANSFER') {
    const legs = await resolveTransferLegs(
      client,
      state.receivingAccountId,
      state.targetReceivingAccountId,
    );
    await assertTransferCurrency(client, state.currencyId, legs.currencyId);
    return {
      currencyId:
        state.currencyId !== undefined ? state.currencyId : legs.currencyId,
      money: legs.source,
      target: legs.target,
    };
  }
  await assertCounterAccount(
    client,
    state.counterAccountId,
    counterDirectionOf(type),
  );
  if (!state.receivingAccountId) {
    if (options.forPosting) {
      throw new BadRequestException({
        code: 'MONEY_ACCOUNT_REQUIRED',
        message: `اختر حساب النقدية / البنك قبل التأكيد — Select the cash / bank account the money ${type === 'OTHER_RECEIPT' ? 'enters' : 'leaves'} before confirming.`,
        fields: [{ field: 'receivingAccountId', constraints: ['required'] }],
      });
    }
    return { currencyId: state.currencyId ?? null, money: null, target: null };
  }
  const money = await loadMoneyAccount(
    client,
    state.receivingAccountId,
    'receivingAccountId',
  );
  const currencyId =
    state.currencyId !== undefined ? state.currencyId : money.currencyId;
  await assertMoneyAccountCurrency(client, currencyId, money);
  return { currencyId, money, target: null };
}
