import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateShippingCompanyDto } from './update-shipping-company.dto';

/**
 * R15 (D15-9) — the carrier form's empty COD-method choice ("") must clear
 * the method (null = COD collections not tracked); omitting the field keeps
 * it unchanged.
 */
describe('Shipping company COD collection method (DTO)', () => {
  const parse = async (body: Record<string, unknown>) => {
    const dto = plainToInstance(UpdateShippingCompanyDto, body);
    return { dto, errors: await validate(dto) };
  };

  it('"" clears the method to null', async () => {
    const { dto, errors } = await parse({ codPaymentMethodId: '' });
    expect(errors).toHaveLength(0);
    expect(dto.codPaymentMethodId).toBeNull();
  });

  it('omitted stays undefined (unchanged); a non-UUID is refused', async () => {
    expect((await parse({ name: 'Carrier' })).dto.codPaymentMethodId).toBe(
      undefined,
    );
    expect(
      (await parse({ codPaymentMethodId: 'not-a-uuid' })).errors,
    ).toHaveLength(1);
  });
});
