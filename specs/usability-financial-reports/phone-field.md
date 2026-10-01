# UI-B — Country-aware phone field (§2)

Status: implemented 2026-09-29 (workstream UI-B). Baseline: design-system §12.

## Library and documentation checked

- `libphonenumber-js` **1.13.9** (single copy in the pnpm store, used by both `apps/web` and
  `apps/api`). Checked against the package's own `README.md` in `node_modules/libphonenumber-js`
  (sections "min vs max vs mobile vs core", `isValid()`, `validatePhoneNumberLength()`,
  `getExampleNumber()`, `formatInternational()`), plus behaviour probes against the installed build.
- Metadata set: **`/min`** on the web (`libphonenumber-js/min`) and the default (`min`) on the API.
  Per the README, with `min` `isValid()` checks the country's possible lengths plus the loose
  national-number pattern; strict per-type digit patterns and `getType()` need `max` (+65 kB).
  Kept deliberately: both sides must use the same metadata so they never disagree, and switching to
  `max` would start rejecting existing stored numbers when their records are edited. Revisit only
  as a joint web+API change.
- The library already parses Arabic-Indic digits, a trunk prefix (EG `010…`, SA `05…`, GB `07…`)
  and digits that repeat the selected country's calling code (`966…` with SA). We still normalize
  digits explicitly (`normalizePhoneDigits`) so both sides agree independently of library internals.

## Decisions

| Topic                                      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                                    | E.164 only (`+966501234567`). The field commits E.164 on blur or on paste of a complete number; an invalid draft is committed as typed so the user can fix it.                                                                                                                                                                                                                                                                                                                                                       |
| Normalization (web + API, identical)       | Arabic-Indic `٠-٩` and Persian `۰-۹` → ASCII; full-width `＋` → `+`; bidi marks / NBSP dropped; spaces, hyphens, dashes, parentheses, dots, slashes stripped; leading `00` → `+`.                                                                                                                                                                                                                                                                                                                                    |
| Calling code without `+`                   | `966501234567` with SA → accepted (no duplicated code). A bare digit string is **never** reinterpreted as another country's number when a country is selected (a mistyped Saudi `5012345678` must not become Belize `+501…`). With no country (imports, `User.mobile`) any calling code is accepted, as before.                                                                                                                                                                                                      |
| Foreign number (different calling code)    | Valid `+20…` while SA is selected: accepted and stored as-is (E.164 keeps its own country), never re-homed. The field shows "This is an Egypt number (+20)…" and, where the form owns the country, an explicit **"Switch country to Egypt"** action. No silent switch. Server behaviour is unchanged (a `+` number is parsed by its own code).                                                                                                                                                                       |
| Shared calling codes                       | `+1` (US/CA/…), `+7` (RU/KZ), `+44` (GB/GG/JE/IM): a number valid for any region of the selected country's calling code is accepted with **no** conflict note — the region is the library's own determination from the leading digits (`sharedCallingCode: true`, `regionMismatch: false`).                                                                                                                                                                                                                          |
| Country changed after a number was entered | The stored E.164 is never rewritten. If it now belongs to another calling code it is shown in full international form next to the new `+CC` prefix with the conflict note; an invalid raw draft is revalidated against the new country.                                                                                                                                                                                                                                                                              |
| Validation timing                          | No error indicator while focused or mid-typing. Error ring + message (Arabic/English, with a library example) appear after blur or once the form's submit was attempted (`forceValidation`); a check mark appears as soon as the number is valid. When the form's own schema already shows a message, the field does not repeat it.                                                                                                                                                                                  |
| Placeholder                                | Library example for the country, grouped without the calling code / trunk zero (SA `51 234 5678`, GB `7400 123456`). Placeholder only, never a value. The separate "Example: …" line under the field was removed (redundant with the placeholder; the example still appears inside error messages).                                                                                                                                                                                                                  |
| Direction                                  | The whole input group is `dir="ltr"`; the `+CC` prefix sits at the start of the number in LTR inside RTL forms.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Existing records                           | No migration or bulk normalization. A stored non-E.164 value displays as stored and is committed/normalized only when the user actually edits the field (focus + blur without a change does not rewrite it).                                                                                                                                                                                                                                                                                                         |
| Read-only display                          | `formatPhoneForDisplay(value, region?)` in `services/phone-service.ts` → `+966 50 123 4567`; unparseable legacy text is returned unchanged.                                                                                                                                                                                                                                                                                                                                                                          |
| Default country                            | Owner decision O2 (2026-10-01): Saudi Arabia (+966) for every new entry unless the user picks another country (`DEFAULT_PHONE_COUNTRY`, `defaultPhoneCountry`, `phoneCountryOrDefault` in `services/phone-service.ts`; `OMSPhoneInput` falls back to SA when no country is selected). The last-used country and the browser region are no longer used.                                                                                                                                                               |
| Phone country vs shipping country          | Only the manual store order has both. Its **Phone country** picker (not persisted — the E.164 carries it) follows the shipping country until the user picks one explicitly, and an empty shipping country defaults from the phone country. A customer picked/applied with a stored foreign phone gets that phone's country. Lead/customer/agent forms have a single country that is also the phone country; a legitimate difference is still possible by entering the `+CC` number (conflict note, optional switch). |

## Forms updated

- Lead / order manual create (`business/lead-order-create-dialog.tsx` via `master-data-form.tsx`
  "phone" fields) and every other master-data phone field (CRM lead edit, customers, suppliers,
  partner quick-create): switch-country action, submit-time validation.
- Manual store order (`store-orders/store-order-create-dialog.tsx` + `config/store-orders/
store-order-create-schema.ts`): name, phone country, phone grouped; schema validates against the
  phone country.
- Store order customer edit (`store-order-edit-customer-dialog.tsx`): plain `Input` replaced by
  the shared phone country + `OMSPhoneInput`; only a changed phone is validated.
- Agent portal lead create (`agent-portal/lead-create-dialog.tsx`): country and mobile on one row;
  invalid phone blocks submit with the field's message. Agent order form: submit-time validation
  display (server remains the gate).

## Tests

- `apps/web/src/services/phone-service.spec.ts` (vitest) and the parity block in
  `apps/api/src/common/phone/phone-number.service.spec.ts` (jest) assert the same concrete E.164
  results: Arabic/Persian digits, separators, `00`, duplicated calling code, EG/SA/GB trunk prefix,
  foreign `+20` → mismatch, bare digits never foreign, US/CA · RU/KZ · GB/GG shared codes, country
  change keeps E.164.

## Open

- Read-only phone displays (`SemanticValue kind="phone"` call sites: lead detail, store order
  detail, agent pages, data-table semantic cell) still print the stored string; wiring
  `formatPhoneForDisplay` there is outside UI-B's file ownership.
