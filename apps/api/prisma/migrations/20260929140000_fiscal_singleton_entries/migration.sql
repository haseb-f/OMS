-- Year Closing / Opening Balance: at most ONE active entry per fiscal year,
-- guaranteed by the database (repeated or concurrent requests can never
-- create a second one). "Active" = POSTED and not itself a reversal; a
-- reversed closing / opening (status REVERSED) and its reversal entry are
-- outside the index, so a controlled reopen -> re-close still works.
-- Additive only: no existing row is touched.
CREATE UNIQUE INDEX "journal_entries_active_fiscal_singleton_key"
  ON "journal_entries" ("source_type", "source_id")
  WHERE "status" = 'POSTED'
    AND "reversal_of_entry_id" IS NULL
    AND "deleted_at" IS NULL
    AND "source_type" IN ('YEAR_CLOSING', 'OPENING_BALANCE');
