-- R13b — read-only consistency check of fixed-asset / prepaid schedules (owner decisions O-1, O-3, O-8).
-- Run before and after migration 20261007100000_r13b_asset_prepaid_corrections; every count should be 0 after.
-- Works on both schemas (pre-R13b columns are read through to_jsonb, so the query never fails before the migration).
--   psql "$DATABASE_URL" -f specs/round13-accounting-reporting/proposals/asset-prepaid-corrections-check.sql
SELECT 'asset_pending_rows_on_disposed_or_archived' AS check_name, COUNT(*) AS rows
FROM fixed_asset_depreciation_periods p
JOIN fixed_assets a ON a.id = p.fixed_asset_id
WHERE p.status = 'PENDING' AND (a.status = 'DISPOSED' OR a.deleted_at IS NOT NULL)
UNION ALL
SELECT 'asset_unposted_rows_on_draft', COUNT(*)
FROM fixed_asset_depreciation_periods p
JOIN fixed_assets a ON a.id = p.fixed_asset_id
WHERE a.status = 'DRAFT' AND p.status <> 'POSTED'
UNION ALL
SELECT 'prepaid_pending_rows_on_cancelled_or_completed', COUNT(*)
FROM prepaid_recognitions r
JOIN prepaid_expenses e ON e.id = r.prepaid_expense_id
WHERE r.status = 'PENDING' AND e.status IN ('CANCELLED', 'COMPLETED')
UNION ALL
SELECT 'prepaid_end_date_not_derived', COUNT(*)
FROM prepaid_expenses
WHERE end_date <> (start_date + make_interval(months => total_periods) - INTERVAL '1 day')::date
UNION ALL
SELECT 'prepaid_active_all_rows_posted', COUNT(*)
FROM prepaid_expenses e
WHERE e.status = 'ACTIVE'
  AND EXISTS (SELECT 1 FROM prepaid_recognitions r WHERE r.prepaid_expense_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM prepaid_recognitions r WHERE r.prepaid_expense_id = e.id AND r.status <> 'POSTED')
UNION ALL
SELECT 'asset_accumulated_not_sum_of_posted', COUNT(*)
FROM fixed_assets a
WHERE a.accumulated_depreciation <> COALESCE(
  (SELECT SUM(p.amount) FROM fixed_asset_depreciation_periods p WHERE p.fixed_asset_id = a.id AND p.status = 'POSTED'), 0)
UNION ALL
SELECT 'prepaid_recognized_not_sum_of_posted', COUNT(*)
FROM prepaid_expenses e
WHERE e.recognized_amount <> COALESCE(
  (SELECT SUM(r.amount) FROM prepaid_recognitions r WHERE r.prepaid_expense_id = e.id AND r.status = 'POSTED'), 0)
  + COALESCE((to_jsonb(e) ->> 'accelerated_amount')::numeric, 0)
ORDER BY 1;
