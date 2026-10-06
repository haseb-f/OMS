-- Round 13 (spec C2): a depreciation / recognition row that will never post
-- because its asset was disposed first. Additive; no data rewrite.
ALTER TYPE "AccountingScheduleStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
