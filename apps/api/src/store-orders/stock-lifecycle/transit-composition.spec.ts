import { dispatchedUnits, sameComposition } from './transit-composition';

const LINE_1 = '11111111-1111-4111-8111-111111111111';
const LINE_2 = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KIT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const dispatch = (
  line: string,
  productId: string,
  quantity: number,
  part = '',
) => [
  {
    productId,
    quantity: -quantity,
    idempotencyKey: `STORE_ORDER_TRANSIT:${line}:${productId}${part}:OUT`,
    parentProductId: KIT,
    recipeId: 'recipe-1',
  },
  {
    productId,
    quantity,
    idempotencyKey: `STORE_ORDER_TRANSIT:${line}:${productId}${part}:IN`,
    parentProductId: KIT,
    recipeId: 'recipe-1',
  },
];

describe('dispatched unit composition (R15 review M4)', () => {
  it('reads one unit of a kit line from its own dispatch movements (sources summed), ignoring receive-backs', () => {
    const movements = [
      ...dispatch(LINE_1, A, 4, ':1'),
      ...dispatch(LINE_1, A, 2, ':2'),
      ...dispatch(LINE_1, B, 3),
      {
        productId: A,
        quantity: 2,
        idempotencyKey: `STORE_ORDER_TRANSIT:${LINE_1}:${A}:BACK:abc-1:IN`,
        parentProductId: KIT,
        recipeId: 'recipe-1',
      },
    ];
    const units = dispatchedUnits(movements, [
      { id: LINE_1, quantity: 3, carried: 0, carriedFrom: null },
    ]);
    expect(units.get(LINE_1)).toEqual([
      { productId: A, quantity: 2, parentProductId: KIT, recipeId: 'recipe-1' },
      { productId: B, quantity: 1, parentProductId: KIT, recipeId: 'recipe-1' },
    ]);
  });

  it('a reship that only carries keeps the composition of the attempt it carried from', () => {
    const units = dispatchedUnits(dispatch(LINE_1, A, 2), [
      { id: LINE_1, quantity: 1, carried: 0, carriedFrom: null },
      { id: LINE_2, quantity: 1, carried: 1, carriedFrom: LINE_1 },
    ]);
    expect(units.get(LINE_2)).toEqual(units.get(LINE_1));
  });

  it('nothing readable (no dispatch, uneven split) → absent; compositions compare order-insensitively', () => {
    const units = dispatchedUnits(dispatch(LINE_1, A, 3), [
      { id: LINE_1, quantity: 2, carried: 0, carriedFrom: null },
      { id: LINE_2, quantity: 1, carried: 0, carriedFrom: null },
    ]);
    expect(units.has(LINE_1)).toBe(false);
    expect(units.has(LINE_2)).toBe(false);
    expect(
      sameComposition(
        [
          { productId: A, quantity: 2 },
          { productId: B, quantity: 1 },
        ],
        [
          { productId: B, quantity: 1 },
          { productId: A, quantity: 2 },
        ],
      ),
    ).toBe(true);
    expect(
      sameComposition(
        [{ productId: A, quantity: 2 }],
        [{ productId: A, quantity: 1 }],
      ),
    ).toBe(false);
  });
});
