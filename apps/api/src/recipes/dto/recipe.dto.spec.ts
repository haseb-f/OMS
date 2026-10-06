import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAssemblyDto } from '../../assembly/dto/assembly.dto';
import { CreateRecipeDto } from './recipe.dto';

const UUID = '3f2b8c1e-5a47-4d0e-9b61-0c7d2a9e4f10';

const lineErrors = async (quantity: unknown) =>
  validate(
    plainToInstance(CreateRecipeDto, {
      lines: [{ componentProductId: UUID, quantity, unitId: UUID }],
    }),
  );

describe('decimal quantities on recipe lines', () => {
  it.each(['2', '0.5', '12.123456', 3, 0.25])('accepts %p', async (value) => {
    expect(await lineErrors(value)).toHaveLength(0);
  });

  it.each(['0', '-1', '1.1234567', 'abc', '', '1e3', null])(
    'rejects %p',
    async (value) => {
      expect((await lineErrors(value)).length).toBeGreaterThan(0);
    },
  );

  it('turns a JSON number into its decimal string form', () => {
    const dto = plainToInstance(CreateRecipeDto, {
      lines: [{ componentProductId: UUID, quantity: 3, unitId: UUID }],
    });
    expect(dto.lines?.[0].quantity).toBe('3');
  });
});

describe('assembly request', () => {
  const base = { productId: UUID, warehouseId: UUID, quantity: 2 };

  it('allows a direct cost of at most 2 decimals, zero included', async () => {
    for (const directCost of ['0', '5', '5.25']) {
      const errors = await validate(
        plainToInstance(CreateAssemblyDto, { ...base, directCost }),
      );
      expect(errors).toHaveLength(0);
    }
    const tooPrecise = await validate(
      plainToInstance(CreateAssemblyDto, { ...base, directCost: '5.255' }),
    );
    expect(tooPrecise.length).toBeGreaterThan(0);
  });

  it('needs a positive whole quantity', async () => {
    for (const quantity of [0, -1, 1.5]) {
      const errors = await validate(
        plainToInstance(CreateAssemblyDto, { ...base, quantity }),
      );
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});
