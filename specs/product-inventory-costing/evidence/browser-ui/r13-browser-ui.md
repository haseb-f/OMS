# R13 UI-driven browser journeys

Generated 2026-10-06T09:24:36.483Z against http://localhost:4801 (run GZRKP). **83/84 PASS**, 1 FAIL, 40 screenshots.

All business records were created and acted on through the UI; the API was used only for read-only assertions.

| Step | Checks | Result       |
| ---- | ------ | ------------ |
| 0    | 3      | **FAIL (1)** |
| 1    | 33     | PASS         |
| 2    | 7      | PASS         |
| 3    | 5      | PASS         |
| 4    | 5      | PASS         |
| 5    | 15     | PASS         |
| 6    | 3      | PASS         |
| 7    | 2      | PASS         |
| 8    | 2      | PASS         |
| 9    | 6      | PASS         |
| 10   | 3      | PASS         |

| Step | Scope               | Check                                                                        | Detail                                                                                                                                     | Result   |
| ---- | ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 0    | desktop/ar          | existing category with a default unit is selectable in the product form (D1) | "[R13-DEMO] Category WBSF76" not offered — selector loads only the first 200 of 421 categories (name order)                                | **FAIL** |
| 0    | desktop/ar          | category with a default unit created through Master data → Categories        | 201 unit=Arabic Search Unit 656fb47b                                                                                                       | PASS     |
| 0    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 1    | desktop/ar          | compX: unit prefilled from the category + hint                               | unit="Arabic Search Unit 656fb47b" expected="Arabic Search Unit 656fb47b" hint=true                                                        | PASS     |
| 1    | desktop/ar          | compX: track stock ON and editable                                           | checked=true                                                                                                                               | PASS     |
| 1    | desktop/ar          | compX: saved (POST /products 201)                                            | PRD-2026-001869                                                                                                                            | PASS     |
| 1    | desktop/ar          | compX: success toast                                                         | تم إنشاء المنتج بنجاح.                                                                                                                     | PASS     |
| 1    | desktop/ar          | compY: unit prefilled from the category + hint                               | unit="Arabic Search Unit 656fb47b" expected="Arabic Search Unit 656fb47b" hint=true                                                        | PASS     |
| 1    | desktop/ar          | compY: track stock ON and editable                                           | checked=true                                                                                                                               | PASS     |
| 1    | desktop/ar          | compY: saved (POST /products 201)                                            | PRD-2026-001870                                                                                                                            | PASS     |
| 1    | desktop/ar          | compY: success toast                                                         | تم إنشاء المنتج بنجاح.                                                                                                                     | PASS     |
| 1    | desktop/ar          | service: unit prefilled from the category + hint                             | unit="Arabic Search Unit 656fb47b" expected="Arabic Search Unit 656fb47b" hint=true                                                        | PASS     |
| 1    | desktop/ar          | service: stock fields hidden for a service                                   | switch=false note=true                                                                                                                     | PASS     |
| 1    | desktop/ar          | service: saved (POST /products 201)                                          | PRD-2026-001871                                                                                                                            | PASS     |
| 1    | desktop/ar          | service: success toast                                                       | تم إنشاء المنتج بنجاح.                                                                                                                     | PASS     |
| 1    | desktop/ar          | kit: unit prefilled from the category + hint                                 | unit="Arabic Search Unit 656fb47b" expected="Arabic Search Unit 656fb47b" hint=true                                                        | PASS     |
| 1    | desktop/ar          | kit: track stock forced OFF with the reason                                  | checked=false locked=true reason=true                                                                                                      | PASS     |
| 1    | desktop/ar          | kit: saved (POST /products 201)                                              | PRD-2026-001872                                                                                                                            | PASS     |
| 1    | desktop/ar          | kit: success toast                                                           | تم إنشاء المنتج بنجاح.                                                                                                                     | PASS     |
| 1    | desktop/ar          | assembled: unit prefilled from the category + hint                           | unit="Arabic Search Unit 656fb47b" expected="Arabic Search Unit 656fb47b" hint=true                                                        | PASS     |
| 1    | desktop/ar          | assembled: track stock forced ON with the reason                             | checked=true locked=true                                                                                                                   | PASS     |
| 1    | desktop/ar          | assembled: saved (POST /products 201)                                        | PRD-2026-001873                                                                                                                            | PASS     |
| 1    | desktop/ar          | assembled: success toast                                                     | تم إنشاء المنتج بنجاح.                                                                                                                     | PASS     |
| 1    | desktop/ar          | compX: stored attributes                                                     | PRD-2026-001869 PRODUCT/PURCHASED tracked=true ACTIVE                                                                                      | PASS     |
| 1    | desktop/ar          | compY: stored attributes                                                     | PRD-2026-001870 PRODUCT/PURCHASED tracked=true ACTIVE                                                                                      | PASS     |
| 1    | desktop/ar          | service: stored attributes                                                   | PRD-2026-001871 SERVICE/PURCHASED tracked=false ACTIVE                                                                                     | PASS     |
| 1    | desktop/ar          | kit: stored attributes                                                       | PRD-2026-001872 PRODUCT/KIT tracked=false ACTIVE                                                                                           | PASS     |
| 1    | desktop/ar          | assembled: stored attributes                                                 | PRD-2026-001873 PRODUCT/ASSEMBLED tracked=true ACTIVE                                                                                      | PASS     |
| 1    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 2    | desktop/ar          | similar-name warning visible and names the existing product                  | shown                                                                                                                                      | PASS     |
| 2    | desktop/ar          | save stays enabled (non-blocking)                                            |                                                                                                                                            | PASS     |
| 2    | desktop/ar          | similar: unit prefilled from the category + hint                             | unit="Arabic Search Unit 656fb47b" expected="Arabic Search Unit 656fb47b" hint=true                                                        | PASS     |
| 2    | desktop/ar          | similar: track stock ON and editable                                         | checked=true                                                                                                                               | PASS     |
| 2    | desktop/ar          | similar: saved (POST /products 201)                                          | PRD-2026-001874                                                                                                                            | PASS     |
| 2    | desktop/ar          | similar: success toast                                                       | تم إنشاء المنتج بنجاح.                                                                                                                     | PASS     |
| 2    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 3    | desktop/ar          | assembled: recipe ACTIVE with the chosen components                          | toast=true status=ACTIVE lines=PRD-2026-001869×2, PRD-2026-001870×1                                                                        | PASS     |
| 3    | desktop/ar          | assembled: panel shows status ACTIVE                                         |                                                                                                                                            | PASS     |
| 3    | desktop/ar          | kit: recipe ACTIVE with the chosen components                                | toast=true status=ACTIVE lines=PRD-2026-001870×1                                                                                           | PASS     |
| 3    | desktop/ar          | kit: panel shows status ACTIVE                                               |                                                                                                                                            | PASS     |
| 3    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 4    | desktop/ar          | compX: opening inventory 10 @ 10 saved + toast                               | 201                                                                                                                                        | PASS     |
| 4    | desktop/ar          | compY: opening inventory 5 @ 15 saved + toast                                | 201                                                                                                                                        | PASS     |
| 4    | desktop/ar          | stock page shows X = 10 and Y = 5                                            | X[ [R13-UI] Component X GZRKP PRD-2026-001869 الشركة 10 10 / 0 100.00] Y[ [R13-UI] Component Y GZRKP PRD-2026-001870 الشركة 5 5 / 0 75.00] | PASS     |
| 4    | desktop/ar          | API stock cards agree (read-only)                                            | 10/5                                                                                                                                       | PASS     |
| 4    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 5    | desktop/ar          | preview lists both components, needed/available and the estimated unit cost  | ready=true components=true/true estimate 2×10+1×15=35.0000:true                                                                            | PASS     |
| 5    | desktop/ar          | assembly posted: success toast with an ASM- number                           | 201 toast=ASM-2026-000010 api=ASM-2026-000010                                                                                              | PASS     |
| 5    | desktop/ar          | detail page shows the number and POSTED                                      | ASM-2026-000010                                                                                                                            | PASS     |
| 5    | desktop/ar          | reversed: toast, badge REVERSED, API status REVERSED with the reason         | api=REVERSED                                                                                                                               | PASS     |
| 5    | desktop/ar          | preview lists both components, needed/available and the estimated unit cost  | ready=true components=true/true estimate 2×10+1×15=35.0000:true                                                                            | PASS     |
| 5    | desktop/ar          | assembly posted: success toast with an ASM- number                           | 201 toast=ASM-2026-000011 api=ASM-2026-000011                                                                                              | PASS     |
| 5    | desktop/ar          | second assembly stays POSTED                                                 | ASM-2026-000011                                                                                                                            | PASS     |
| 5    | desktop/ar          | component stock after assemble/reverse/assemble: X = 8, Y = 4                | 8/4                                                                                                                                        | PASS     |
| 5    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 6    | desktop/ar          | save refused with the Arabic PRODUCT_TRACKING_LOCKED message in the form     | switchOff=true http=409 msg=true                                                                                                           | PASS     |
| 6    | desktop/ar          | product is still stock-tracked (read-only GET)                               |                                                                                                                                            | PASS     |
| 6    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 7    | desktop/ar          | kit availability shown and equals the API (min of component availability)    | ui=4 api=4                                                                                                                                 | PASS     |
| 7    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 8    | desktop/ar          | integrity report rendered (I1–I7) with no FAIL card                          | I1:PASS I2:PASS I3:PASS I4:PASS I5:PASS I6:WARN I7:PASS failCard=0                                                                         | PASS     |
| 8    | desktop/ar          | no console errors                                                            |                                                                                                                                            | PASS     |
| 1    | mobile/ar           | product form dialog: no horizontal scroll at 390px                           | scrollWidth=390                                                                                                                            | PASS     |
| 1    | mobile/ar           | mobile: unit prefilled from the category + hint                              | unit="Arabic Search Unit 656fb47b" expected="Arabic Search Unit 656fb47b" hint=true                                                        | PASS     |
| 1    | mobile/ar           | mobile: track stock ON and editable                                          | checked=true                                                                                                                               | PASS     |
| 1    | mobile/ar           | mobile: saved (POST /products 201)                                           | PRD-2026-001875                                                                                                                            | PASS     |
| 1    | mobile/ar           | mobile: success toast                                                        | تم إنشاء المنتج بنجاح.                                                                                                                     | PASS     |
| 1    | mobile/ar           | product list after create: no horizontal scroll at 390px                     | scrollWidth=390                                                                                                                            | PASS     |
| 1    | mobile/ar           | no console errors                                                            |                                                                                                                                            | PASS     |
| 5    | mobile/ar           | preview lists both components, needed/available and the estimated unit cost  | ready=true components=true/true estimate 2×10+1×15=35.0000:true                                                                            | PASS     |
| 5    | mobile/ar           | new-assembly dialog: no horizontal scroll at 390px                           | scrollWidth=390                                                                                                                            | PASS     |
| 5    | mobile/ar           | assembly posted: success toast with an ASM- number                           | 201 toast=ASM-2026-000012 api=ASM-2026-000012                                                                                              | PASS     |
| 5    | mobile/ar           | assembly detail: no horizontal scroll at 390px                               | scrollWidth=390                                                                                                                            | PASS     |
| 5    | mobile/ar           | component stock after the mobile assembly: X = 6, Y = 3                      | 6/3                                                                                                                                        | PASS     |
| 5    | mobile/ar           | no console errors                                                            |                                                                                                                                            | PASS     |
| 9    | agent /agent/stock  | /agent/stock renders                                                         | /agent/stock                                                                                                                               | PASS     |
| 9    | agent /agent/stock  | /agent/stock: no cost columns                                                | \| المنتج \| المستودع \| الرصيد الفعلي \| المحجوز \| المتاح \| المشحون \| المرتجع                                                          | PASS     |
| 9    | agent /agent/stock  | no console errors                                                            |                                                                                                                                            | PASS     |
| 9    | agent /agent/orders | /agent/orders renders                                                        | /agent/orders                                                                                                                              | PASS     |
| 9    | agent /agent/orders | /agent/orders: no cost columns                                               | \| رقم الطلب \| التاريخ \| العميل \| المنتجات \| الإجمالي المستحق \| الحالة المُبلَّغة \| حالة المالية \| التنفيذ                          | PASS     |
| 9    | agent /agent/orders | no console errors                                                            |                                                                                                                                            | PASS     |
| 10   | desktop/en          | product list in English: dir=ltr                                             | dir=ltr                                                                                                                                    | PASS     |
| 10   | desktop/en          | assembly list in English: dir=ltr, English title                             | dir=ltr                                                                                                                                    | PASS     |
| 10   | desktop/en          | no console errors                                                            |                                                                                                                                            | PASS     |

Screenshots:

- [00a-category-selector-cap.png](./00a-category-selector-cap.png)
- [00b-category-create.png](./00b-category-create.png)
- [01a-product-component-x.png](./01a-product-component-x.png)
- [01a-product-component-x-success.png](./01a-product-component-x-success.png)
- [01b-product-component-y.png](./01b-product-component-y.png)
- [01b-product-component-y-success.png](./01b-product-component-y-success.png)
- [01c-product-service.png](./01c-product-service.png)
- [01c-product-service-success.png](./01c-product-service-success.png)
- [01d-product-kit.png](./01d-product-kit.png)
- [01d-product-kit-success.png](./01d-product-kit-success.png)
- [01e-product-assembled.png](./01e-product-assembled.png)
- [01e-product-assembled-success.png](./01e-product-assembled-success.png)
- [02-product-similar-name-warning.png](./02-product-similar-name-warning.png)
- [02-product-similar-name-warning-success.png](./02-product-similar-name-warning-success.png)
- [03a-recipe-assembled-draft.png](./03a-recipe-assembled-draft.png)
- [03a-recipe-assembled.png](./03a-recipe-assembled.png)
- [03b-recipe-kit-draft.png](./03b-recipe-kit-draft.png)
- [03b-recipe-kit.png](./03b-recipe-kit.png)
- [04a-opening-inventory-x.png](./04a-opening-inventory-x.png)
- [04b-opening-inventory-y.png](./04b-opening-inventory-y.png)
- [04c-stock-page.png](./04c-stock-page.png)
- [05a-assembly-1-preview.png](./05a-assembly-1-preview.png)
- [05a-assembly-1-posted.png](./05a-assembly-1-posted.png)
- [05b-assembly-detail-posted.png](./05b-assembly-detail-posted.png)
- [05c-assembly-reverse-dialog.png](./05c-assembly-reverse-dialog.png)
- [05d-assembly-detail-reversed.png](./05d-assembly-detail-reversed.png)
- [05e-assembly-2-preview.png](./05e-assembly-2-preview.png)
- [05e-assembly-2-posted.png](./05e-assembly-2-posted.png)
- [06-tracking-locked.png](./06-tracking-locked.png)
- [07-kit-availability.png](./07-kit-availability.png)
- [08-integrity.png](./08-integrity.png)
- [01m-product-mobile.png](./01m-product-mobile.png)
- [01m-product-mobile-success.png](./01m-product-mobile-success.png)
- [05m-assembly-mobile-preview.png](./05m-assembly-mobile-preview.png)
- [05m-assembly-mobile-posted.png](./05m-assembly-mobile-posted.png)
- [05m-assembly-mobile-detail.png](./05m-assembly-mobile-detail.png)
- [09a-agent-stock.png](./09a-agent-stock.png)
- [09b-agent-orders.png](./09b-agent-orders.png)
- [10a-en-products.png](./10a-en-products.png)
- [10b-en-assembly-list.png](./10b-en-assembly-list.png)
