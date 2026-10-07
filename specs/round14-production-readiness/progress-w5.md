# W5 progress — company partners and profit sharing ("الشركاء")

Branch `feat/r14-partners`, worktree `D:/Systems/OMS-r14-w5`, DB `oms_r14_w5`. Newest first.

## 2026-10-07 — schema + migration

- Prisma: `CompanyPartnerProfile`, `PartnerAgreement`, `PartnerProfitPeriod`, `PartnerProfitAdjustment`
  (adjustment batch — one posting per correction run), `PartnerEntitlement`, `PartnerPayment`;
  `PostingSettings.partnerProfitDistributionAccountId` / `partnerProfitPayableAccountId`.
- Migration `20261008140000_r14_company_partners` (hand-written from `migrate diff`, pre-existing
  `prepaid_expenses` FK drift excluded): tables, permissions `company-partners.view|manage|close|pay`
  (granted to nobody), number series `COMPANY_PARTNER_PAYMENT` (PPY). Applied on `oms_r14_w5`.
