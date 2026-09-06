-- Lead Status Simplification (Workflow Status Management admin UX).
--
-- Target lifecycle: NEW -> IN_PROGRESS -> QUALIFIED -> CONVERTED, with
-- LOST/DISQUALIFIED terminal and a REOPEN path back to IN_PROGRESS.
--
-- ASSIGNED and CONTACTED are superseded LEAD statuses: no application code
-- path has ever set a Lead into either (confirmed against local data — zero
-- leads, zero status_history rows for both). FOLLOW_UP is being retired as a
-- lifecycle stage too (a follow-up is now a LeadFollowUp activity, never a
-- status mutation — see leads.service.ts addFollowUp()), but it DOES have
-- real history, so unlike ASSIGNED/CONTACTED its StatusDefinition row is left
-- alone here.
--
-- This migration only deactivates transitions (is_active = false) — it never
-- deletes or archives a StatusDefinition row, never touches status_history,
-- and is fully reversible (flip is_active back). Archiving the now-orphaned
-- ASSIGNED/CONTACTED StatusDefinition rows themselves is left to an admin via
-- the Workflow Statuses screen, which safely refuses if any environment
-- (including production) still has a live record on that status.

-- Orphan ASSIGNED and CONTACTED from the active LEAD transition graph.
UPDATE "workflow_transitions" wt
SET "is_active" = false, "updated_at" = CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE wt."from_status_id" = f.id
  AND wt."to_status_id" = t.id
  AND wt."workflow_type" = 'LEAD'
  AND wt."is_active" = true
  AND wt."deleted_at" IS NULL
  AND (f.code IN ('ASSIGNED', 'CONTACTED') OR t.code IN ('ASSIGNED', 'CONTACTED'));

-- Stop new leads from entering FOLLOW_UP going forward (addFollowUp() no
-- longer transitions status either). Outbound FOLLOW_UP transitions
-- (-> QUALIFIED / LOST / DISQUALIFIED) stay active so any lead already
-- resting in FOLLOW_UP keeps a valid way forward, same as the existing
-- LOST/DISQUALIFIED reopen pattern.
UPDATE "workflow_transitions" wt
SET "is_active" = false, "updated_at" = CURRENT_TIMESTAMP
FROM "status_definitions" f, "status_definitions" t
WHERE wt."from_status_id" = f.id
  AND wt."to_status_id" = t.id
  AND wt."workflow_type" = 'LEAD'
  AND wt."is_active" = true
  AND wt."deleted_at" IS NULL
  AND f.code IN ('NEW', 'IN_PROGRESS')
  AND t.code = 'FOLLOW_UP';
