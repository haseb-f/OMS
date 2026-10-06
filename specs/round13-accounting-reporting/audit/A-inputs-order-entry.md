# Audit A — shared inputs and order entry (2026-10-06)

## Phone

- Shared `OMSPhoneInput` (`components/shared/phone-input.tsx`); in-field `CallingCodePicker` only when `countries` + `onCountryChange` passed. RHF wrapper `form-fields/phone-field.tsx`; `master-data-form.tsx` internal `PhoneFormField` links to `countryFieldName` (selector shown only then — and the phone country is then _the address country_, i.e. they cannot differ).
- Store order / agent order: selector present. Customers / Suppliers / Leads: selector tied to `countryId` (address country). Partner quick-create: fixed +966, no selector. Users: `countryCode={null}`, no selector. Employees, Agents (admin), Investors: plain text inputs.
- API: `PhoneNumberService` (`common/phone/phone-number.service.ts`), `phoneSearchCandidates`; `PartnersService.normalizePartnerPhone` stores raw value unvalidated when no countryId (gap); `PartnerPhoneKey` race-safe duplicate key. No entity stores a phone-country column — E.164 carries the calling code, so a separate column is unnecessary.

## Passwords

- `PasswordInput` (show/hide + copy) exists; user create has a "generate" checkbox that asks the **server** to generate (user never sees it before save); reset is server-generated only, shown in `GeneratedPasswordDialog` with `CopyButton`.
- Policy: only `@MinLength(8)` repeated in 4 DTOs + service (no single policy constant). Generator `auth/password.util.ts generateTemporaryPassword` (crypto.randomBytes, upper/lower/digit/symbol). Generated → `mustChangePassword: true`.

## Dropdowns

- Radix Select portaled, popper, collisionPadding 8, max-h min(20rem, available). Command list max-h min(270px, available-3.5rem). `EntityCombobox` / `CallingCodePicker` are `Popover modal={false}` portaled — **inside a modal Dialog the Dialog's scroll lock (react-remove-scroll) swallows wheel/touch scroll on portaled non-modal content**. No workaround in code.

## Blue palette

- Tones 1..5 in `globals.css` (tone 1 darkest). `toolbar-tones.ts assignToolbarTones` numbers in DOM order → in RTL the darkest is on the RIGHT. Guard: `selector-triggers.spec.tsx` asserts SelectorRow tones `["1","2","3"]` in logical order; `toolbar-tones.spec.ts` ordering.

## Order creation

- `StoreOrderCreateDialog` 1002 lines, one long `EnterpriseModal`: customer (+duplicate panel, delivery), order info, items, payment declaration, notes/receipts, summary. Idempotency key + isSubmitting. Agent form `agent-order-form.tsx` 823 lines page, own idempotency key + quote.
- No shared stepper component (only bespoke `PRODUCT_WIZARD_STEPS` in product-create-dialog).
