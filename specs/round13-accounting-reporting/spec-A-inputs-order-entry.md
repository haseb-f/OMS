# SPEC A — Shared input controls and order-entry experience

Audit: `audit/A-inputs-order-entry.md`.

## A1. Editable international phone numbers

**Current.** `OMSPhoneInput` + `CallingCodePicker` are shared, but the picker appears only when the form wires `countries` + `onCountryChange`. Master-data forms (Customers, Suppliers, Leads) bind the picker to the _address_ `countryId`, so phone country = address country. Users: no picker (fixed default). Partner quick-create: fixed +966. Employees, Agents (admin), Investors: plain text. API `normalizePartnerPhone` stores raw text when no country is sent.

**Target.**

- Every partner/user phone uses `OMSPhoneInput` with the in-field calling-code selector (Users, Customers, Suppliers, Leads, partner quick-create, Employees, Agents).
- The phone's calling code is **its own UI state**, derived from the stored E.164 on edit; the address country only _proposes_ it while the user has not picked a code and has not typed a number (same rule as R12 `country-entry-defaults`). Changing the address country never rewrites an explicit code or an existing number.
- No new column: E.164 already encodes the calling code; a separate "phone country" field would duplicate it.
- API: a phone without a country is read through `PhoneNumberService.lookupCandidates` (R11 one path) and rejected when no valid reading exists, instead of storing raw text. Duplicate detection keeps `PartnerPhoneKey` (E.164).

**Acceptance.** Customer with address Egypt and phone +966 saves and re-opens with +966; supplier and user forms allow overriding the code; editing preserves the existing number; changing country after typing keeps the code.

## A2. Password suggestion, visibility, copying

**Current.** Policy = `@MinLength(8)` copied in 4 DTOs; server generator `generateTemporaryPassword` (crypto, upper/lower/digit/symbol). Create offers a "server generates" checkbox (password unseen until saved); reset is server-generated only.

**Target.**

- One policy constant `PASSWORD_POLICY` in `@oms/shared` (min 8, max 200, generator classes) used by API DTOs/services and the web.
- `PasswordInput` gains **Generate** / **Regenerate** using `crypto.getRandomValues` (rejection sampling, no modulo bias) producing a 14-char password meeting the policy; reveal/hide; copy with a "Copied" toast. Used in user create and in the authorized reset dialog (reset may now take an admin-entered/generated password; empty still means server-generated).
- Never logged, never in URLs/analytics; evidence uses placeholders. Reset/session policy unchanged (`mustChangePassword` still set for admin-set passwords).

## A3. Dropdown scrolling and blue direction

**Current.** Radix Select is portaled with collision handling. `EntityCombobox` / `CallingCodePicker` are non-modal portaled popovers; inside a modal Dialog, its scroll lock blocks wheel/touch on them. Tones: tone 1 darkest, assigned in DOM order → RTL darkest on the right.

**Target.**

- Portaled popover/command content scrolls by wheel, touch and keyboard inside dialogs/sheets (stop the scroll-lock from swallowing events on portaled content; keep `scrollIntoView` for the active option).
- **New direction (supersedes R9/R12):** the sequence is defined logically — tone 1 = **lightest** at the inline-start, darkening toward the inline-end. RTL: lightest on the RIGHT → darkest on the LEFT. LTR: lightest on the LEFT → darkest on the RIGHT. Implemented by re-ordering the token ramp (no per-direction code); standalone control stays tone 3; form surfaces stay very light blue; status colours untouched.

## A4. Sequential order creation

**Current.** `StoreOrderCreateDialog` (1002 lines) is one long modal; no shared stepper exists.

**Target.** A shared `StepFlow` (header with numbered steps, current/remaining state, Back / Next / Create footer) used by the company order dialog:

1. **Customer** — new/existing, name, country, phone, duplicate recognition + acknowledgement.
2. **Products** — lines and quantities.
3. **Delivery & payment** — delivery, order info (currency, payment type, fulfillment), payment declaration (permission-gated), notes/receipts.
4. **Review** — read-only summary with totals explanation; **Create**.

- One RHF form across steps (values survive Back/Next); Next validates only the current step's fields; never auto-advances; Enter in an input does not submit; idempotency key + disabled submit prevent double creation; a server error returns to the step holding the field. Mobile: full-height sheet layout, sticky footer above the keyboard.
- Agent form keeps its page layout this round (its quote/tariff logic differs); it already prevents duplicate submission.

## Permissions / migration

No permission changes. No schema migration.

## Verification

Vitest for phone-code ownership, password generator (policy, distribution sanity), tone order; browser: code override on user/customer/supplier, generate/reveal/copy, long dropdown in a mobile dialog, full mobile order flow.
