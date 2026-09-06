-- Lead Status Simplification, part 2: retire ASSIGNED and CONTACTED.
--
-- These two LEAD statuses are superseded (ASSIGNED was never wired to any
-- transition or code path; CONTACTED was superseded by IN_PROGRESS — see the
-- previous migration). This is a soft delete (deleted_at), reversible via the
-- Workflow Statuses "Restore" action, and self-verifying per environment: it
-- only archives a status when this database currently has zero active Leads
-- on it, mirroring the same guard StatusDefinitionsService.archive() enforces
-- at runtime. On a database where either status still has live leads (e.g. a
-- production database that used them differently than local dev), this
-- UPDATE simply archives nothing for that code, leaving it for an admin to
-- review in the Workflow Statuses screen.

UPDATE "status_definitions" sd
SET "deleted_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
WHERE sd."workflow_type" = 'LEAD'
  AND sd."code" IN ('ASSIGNED', 'CONTACTED')
  AND sd."deleted_at" IS NULL
  AND sd."is_default" = false
  AND NOT EXISTS (
    SELECT 1 FROM "leads" l
    WHERE l."status_id" = sd."id" AND l."deleted_at" IS NULL
  );
