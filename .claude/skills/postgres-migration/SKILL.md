---
name: postgres-migration
description: Write, review, and safely apply a PostgreSQL schema migration for the Felix harness. Use when adding or altering tables, columns, indexes, or constraints, when reviewing someone else's migration, or before applying one to staging or production — covers expand/contract sequencing, lock profiles, tenant-first indexing, and rollback.
license: MIT
compatibility: Requires a felix-run/felix checkout for the migration tooling; psql or the Neon MCP tools for a live database
metadata:
  repo: felix-web
---

# Postgres migrations

The schema belongs to the Python harness ([felix-run/felix](https://github.com/felix-run/felix)),
not to `felix-web`. Locate that checkout first; read the existing migrations and match their tool,
naming, and up/down conventions before writing anything. Detailed patterns and the lock-profile
table are in `references/lock-profiles.md`.

## The rule that prevents most incidents

**Expand → migrate → contract, across separate deploys.**

1. **Expand**: add the new column/table/index, nullable or defaulted, tolerated by the running code.
2. **Migrate**: ship code that writes both and reads the new; backfill in batches.
3. **Contract**: only once nothing reads the old shape, drop it.

A destructive change deployed together with the code that depends on it has no rollback: reverting
the code leaves the schema broken, and reverting the schema loses data.

## Before you write

- Is this reversible? Write the `down` and be honest if it cannot restore data.
- What is the table's size and write rate? Lock behavior that is free on a dev table is an outage on
  a hot one.
- Does it touch tenant-scoped data? Then the tenant column leads the primary key and every index
  serving a tenant query.

## Lock discipline — the short version

- `CREATE INDEX` blocks writes → use **`CREATE INDEX CONCURRENTLY`**, which cannot run inside a
  transaction, so it needs its own migration step (and can leave an `INVALID` index if it fails —
  drop and retry).
- `ADD COLUMN` with a constant default is cheap on modern Postgres; with a **volatile** default it
  rewrites the table.
- `SET NOT NULL` scans the whole table under an ACCESS EXCLUSIVE lock → add a `CHECK … NOT VALID`
  constraint, `VALIDATE` it separately, then set not-null.
- `ALTER COLUMN TYPE` usually rewrites and blocks → prefer a new column plus a backfill.
- Any DDL that waits on a lock **queues every query behind it**. Set a short `lock_timeout` and
  retry rather than letting a migration take the table down.

## Applying it

- Local/dev freely. **Staging and production are ask-gated** — never apply one unless the user asks
  in that turn, and state the lock profile and expected duration first.
- Against a live database prefer the Neon MCP tools when the project is on Neon
  (`describe_table_schema`, `explain_sql_statement`, `run_sql`, `prepare_database_migration`), and
  do exploratory work on a **branch**, never on production.
- Confirm a backup or PITR window exists before anything destructive.

## Review checklist

- [ ] Reversible, with a real `down` — or an explicit written rollback plan
- [ ] No blocking DDL on a hot table; concurrent index build in its own step
- [ ] Tenant column leads the PK and the relevant indexes
- [ ] Each new index justified by a query, and not already covered by an existing index prefix
- [ ] `timestamptz` for time; no float for money
- [ ] Backfill is batched and interruptible, not one giant `UPDATE`
- [ ] Deployed in the right order relative to the code that uses it

## Report

The migration, the lock profile of each statement, the measured or estimated duration, the rollback
path, and what a human must approve before production.
