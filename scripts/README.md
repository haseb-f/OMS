# Scripts

Operational and developer-experience scripts (setup, database seeding, CI helpers, etc.).
No scripts have been added yet.

## Client copy

`bash scripts/package-client-copy.sh [ref] [output-dir]` builds a clean zip of tracked source (no secrets, `node_modules`, `tmp/` or QA evidence) for handing to a client. It uses `git archive`, so the working project stays the single source of truth.
