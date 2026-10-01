# Production cutover scripts

Everything needed to move the live site from the old version (direct table access) to the
new one (functions + admin sessions), with a rehearsal on a copy of production data first.

**Nothing here runs by itself, and nothing here has been run against production.**

## Safety rules built into every script

- The target is explicit: `--target production|rehearsal|local` plus `--ref` and `--host`.
  The detected target, project ref, server and row counts are printed before anything happens.
- **gatta-test is always refused.** `production` only accepts the production ref
  (`izvmrfbaihfeuadqfofl`, cross-checked against `.env.local`); `rehearsal` refuses that ref.
- The database password is typed at a hidden prompt each time. It is never stored, never
  written to a file, never placed on a command line.
- Read-only scripts force a read-only session before their first query.
- Mutating scripts require an exact typed phrase containing the project ref, and each runs in
  a single transaction (an error rolls the whole step back).
- Production mutations refuse to start without a backup made in the last 24 hours, the
  captured state, and the prepared rollback file.
- **Migration 1 is never applied.** It is a local-test baseline that creates the tables and
  inserts fake rows. It is only *recorded* as applied in step 05.
- Exports go to `backups/`, which is git-ignored (real names and IBANs).

## The scripts

| Script | Writes to the database? | What it does |
|---|---|---|
| `01-backup-readonly.sh` | No | CSV export of every public table, with row-count and checksum verification |
| `02-capture-state.sh` | No | Schema, RLS, policies, grants, functions, default privileges, splits still in use; also a `schema-recreate.sql` for the rehearsal |
| `06-rollback-prepare.sh` | No (offline) | Builds `rollback-restore-access.sql` from the captured state |
| `03-apply-additive.sh` | Yes | Migrations 2, 3, 5, 6, 7, 8, 9 (+ bank columns if missing). The old site keeps working |
| `04-apply-lockdown.sh` | Yes | Migrations 4, 10, then 3 again. **The old site stops working.** Ends with a verification |
| `05-repair-and-status.sh status` | No | Migration history + lockdown verification + row counts vs. backup |
| `05-repair-and-status.sh repair` | Bookkeeping only | Records migrations 1–10 as applied |
| `07-rollback-apply.sh` | Yes (emergency) | Re-opens direct table access for the old site |
| `rehearsal-load.sh` | Yes (never production) | Loads a copy of production into an empty rehearsal project |
| `selftest-local.sh` | Local cluster only | Runs the whole sequence on a fake database on this Mac |

`<host>` is the **Session pooler** host shown under *Connect* in the Supabase dashboard
(looks like `aws-0-<region>.pooler.supabase.com`); each project has its own.

## Rehearsal (do this first)

1. In the Supabase dashboard create a new, empty project named `gatta-rehearsal`. Note its ref,
   its Session pooler host and its database password.
2. Read-only export from production (the only steps that contact production):
   ```
   bash scripts/cutover/01-backup-readonly.sh --target production --ref izvmrfbaihfeuadqfofl --host <prod-host>
   bash scripts/cutover/02-capture-state.sh   --target production --ref izvmrfbaihfeuadqfofl --host <prod-host> --dir backups/<folder>
   bash scripts/cutover/06-rollback-prepare.sh --dir backups/<folder>
   ```
   Read `backups/<folder>/state/summary.txt` and `rollback-restore-access.sql`.
3. Load the copy and rehearse the exact production sequence:
   ```
   bash scripts/cutover/rehearsal-load.sh      --target rehearsal --ref <reh-ref> --host <reh-host> --from backups/<folder>
   bash scripts/cutover/03-apply-additive.sh   --target rehearsal --ref <reh-ref> --host <reh-host>
   bash scripts/cutover/04-apply-lockdown.sh   --target rehearsal --ref <reh-ref> --host <reh-host>
   bash scripts/cutover/05-repair-and-status.sh repair --target rehearsal --ref <reh-ref> --host <reh-host>
   bash scripts/cutover/05-repair-and-status.sh status --target rehearsal --ref <reh-ref> --host <reh-host> --dir backups/<folder>
   ```
4. Point a local build at the rehearsal project (its URL, anon key and service-role key in a
   temporary env file) and open several real split links: they must show the read-only
   banner with the right names and paid marks. Create one new split and run it end to end.
5. Rehearse the rollback: `07-rollback-apply.sh --target rehearsal ... --dir backups/<folder>`,
   then `04` again.
6. Delete the `gatta-rehearsal` project and the `backups/<folder>` copy when done.

## Cutover order (production)

1. `01` → `02` → `06` (fresh backup, state, rollback file).
2. Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel Production.
3. `03-apply-additive.sh` — old site still working.
4. `vercel deploy --prod --skip-domain` → check the staged build → `vercel promote <url>`.
5. `04-apply-lockdown.sh` — immediately after the new site is live.
6. `05-repair-and-status.sh repair`, then smoke tests.
7. Fast-forward `main` to the branch and push.

Rollback: `vercel promote <previous production deployment>` and, if step 5 already ran,
`07-rollback-apply.sh`.
