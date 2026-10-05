import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';

export interface DecimalStringOptions {
  /** Most fractional digits accepted (matches the column scale — never a silent rounding). */
  maxDecimals: number;
  /** Most integer digits accepted (matches the column precision). */
  maxIntegerDigits: number;
  /** `true` = strictly greater than zero; otherwise zero is allowed. */
  positive?: boolean;
}

/**
 * A non-negative decimal quantity / amount sent as a decimal string (JSON
 * numbers are accepted and turned into their string form). Keeps money and
 * recipe quantities out of floating point from the request onwards: services
 * feed the string straight into `Prisma.Decimal`.
 */
export function IsDecimalString(
  options: DecimalStringOptions,
  validationOptions?: ValidationOptions,
) {
  const pattern = new RegExp(
    String.raw`^\d{1,${options.maxIntegerDigits}}(\.\d{1,${options.maxDecimals}})?$`,
  );
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : value,
    ),
    ValidateBy(
      {
        name: 'isDecimalString',
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' &&
            pattern.test(value) &&
            (!options.positive || Number(value) > 0),
          defaultMessage: (args) =>
            `${args?.property ?? 'value'} must be a ${options.positive ? 'positive' : 'non-negative'} decimal with at most ${options.maxDecimals} fractional digits.`,
        },
      },
      validationOptions,
    ),
  );
}
