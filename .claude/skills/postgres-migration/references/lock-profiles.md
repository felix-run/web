# DDL lock profiles and safe rewrites

Reference for `postgres-migration`. Verify against the major version in use — the cheap paths below
assume a reasonably modern PostgreSQL.

## Lock levels that matter

| Lock | Blocks | Typical source |
|---|---|---|
| `ACCESS EXCLUSIVE` | everything, including `SELECT` | most `ALTER TABLE`, `DROP`, non-concurrent index ops |
| `SHARE` | writes | `CREATE INDEX` (non-concurrent) |
| `SHARE UPDATE EXCLUSIVE` | other DDL only | `CREATE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT` |

The duration matters more than the level — an `ACCESS EXCLUSIVE` lock held for 2 ms is invisible;
held for 40 s it is an outage. And because lock requests queue, one blocked DDL statement stalls
every query that arrives after it, even short ones.

## Operation table

| Operation | Cost | Safe form |
|---|---|---|
| `ADD COLUMN` (no default / constant default) | metadata only | safe as-is |
| `ADD COLUMN` (volatile default, e.g. `now()`, `gen_random_uuid()`) | full rewrite | add nullable → backfill in batches → set default |
| `SET NOT NULL` | full scan, ACCESS EXCLUSIVE | `ADD CHECK (col IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT` → `SET NOT NULL` |
| `ALTER COLUMN TYPE` | usually rewrite | new column + backfill + swap; widening `varchar(n)` limits is metadata-only |
| `CREATE INDEX` | blocks writes | `CREATE INDEX CONCURRENTLY`, own migration step, no transaction |
| `DROP INDEX` | brief ACCESS EXCLUSIVE | `DROP INDEX CONCURRENTLY` |
| `ADD FOREIGN KEY` | scans both tables | `... NOT VALID` → `VALIDATE CONSTRAINT` later |
| `ADD PRIMARY KEY` | builds index, blocks | build unique index concurrently → `ADD CONSTRAINT ... USING INDEX` |
| `RENAME COLUMN/TABLE` | instant, but breaks running code | expand/contract instead: add new, dual-write, drop old |
| `DROP COLUMN` | metadata only, irreversible | only after nothing reads it; data is unrecoverable |
| `TRUNCATE` | ACCESS EXCLUSIVE, irreversible | almost never in a migration |

## Guardrails

```sql
SET lock_timeout = '3s';         -- fail fast instead of queueing everything behind you
SET statement_timeout = '30s';   -- keep a runaway migration from hanging the deploy
```

Wrap DDL in a retry loop rather than waiting on a lock indefinitely. `CREATE INDEX CONCURRENTLY`
must be outside a transaction, so it cannot share a transactional migration step; on failure it
leaves an `INVALID` index that must be dropped before retrying.

## Backfills

- Batch by primary key range with a bounded `LIMIT`, committing each batch; never one statement over
  the whole table.
- Sleep briefly between batches on a busy system so autovacuum and replication keep up.
- Make it resumable and idempotent — assume it will be interrupted.
- Watch replication lag while it runs; a fast backfill that lags replicas is still an incident.

## Multi-tenant specifics

- Tenant column first in the primary key and in composite indexes, so tenant-scoped queries get a
  prefix match.
- A query with no tenant predicate is a **cross-tenant data leak**, not a performance bug — treat it
  as a security finding.
- Uniqueness is almost always per-tenant: `UNIQUE (tenant_id, name)`, not `UNIQUE (name)`.
