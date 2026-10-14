# Stock-movement signs and colours (owner brief 2026-10-14)

## Semantics found (ADR-0013, `inventory.service.ts`)

- One movement row = one warehouse. Physical effect at that warehouse = `quantityAfter − quantityBefore`
  (a transfer is two rows: source −q, destination +q).
- `RESERVATION` stores **+q** and `RESERVATION_RELEASE` **−q** on the separate reserved ledger; on-hand is
  unchanged (before = after).
- Defect: the screens coloured by the stored sign only — a reservation showed as a green "+10" receipt, a release
  as a red "−10" issue — and the type badge was green for a few "positive" types, neutral for all others.

## Rule (one shared helper `config/inventory/movement-effect.ts` + `components/inventory/movement-quantity.tsx`)

| Movement                                 | Shown                                                     |
| ---------------------------------------- | --------------------------------------------------------- |
| Physical increase at the row's warehouse | green `+100`, package-plus icon, badge green              |
| Physical decrease                        | red `−100` (U+2212), package-minus icon, badge red        |
| Transfer                                 | red at the source row, green at the destination row       |
| Zero physical change                     | neutral `0`                                               |
| Reservation                              | blue `المتاح −10`, lock icon, badge «حجز» blue            |
| Reservation release                      | blue `المتاح +10`, open-lock icon, badge «إلغاء حجز» blue |

Reservation rows carry the note "changes reserved and available quantities only — physical on-hand stock is
unchanged" (tooltip + screen-reader text). Signs are bidi-isolated (`<bdi dir="ltr">`). Used by the movements table,
the Grid card, the product movement history, the inventory report, the agent stock history and the record
preview (type-only tone). Presentation only — no balance or historical record changed.

## Checklist

- [x] Unit: receipts / returns / openings / consignment / production output +; deliveries / supplier returns /
      damage / expiry / consumption −; transfer both sides; adjustment and count read from before → after; zero;
      reservation available −; release available +; agent history without before / after (10 + 3 tests).
- [x] Local build (`oms_r20_final`, real movements: receipts, deliveries, returns, 80 transfer rows, 119
      reservations, 44 releases): `r21-movement-signs-shots.mjs` 15 / 15 (ar light 1440, en dark 1440, ar 375);
      transfer filter red / green per warehouse; sales returns green.
- [x] Web typecheck, lint 0 errors, vitest 186 files / 1337, next build.
