# Before running `prisma migrate deploy`

**Do NOT run it on the old server (13.206.157.201).** That database has no
`_prisma_migrations` table at all — Prisma has no record of its history, so
deploy would try to replay all seven migrations, starting with `init`, against
a schema that has diverged from them since June. Apply SQL by hand there.

**On the new server**, check what is already recorded first:

```sql
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY finished_at;
```

- If the six June migrations are listed, `prisma migrate deploy` will apply
  only `20261016000000_call_analytics_webhooks` and nothing else. That is what
  you want.
- If any are **missing**, deploy will try to replay them. Those older
  migrations are NOT idempotent and will fail against the existing schema.
  Mark them applied instead, without running them:

  ```bash
  npx prisma migrate resolve --applied 20260603085518_init
  # ...repeat for each one listed in prisma/migrations but absent above
  ```

The new migration itself is written to be safely re-runnable, so applying it
twice is harmless. The older six are not.

## Applying by hand instead

The same SQL is `prisma/migrations/20261016000000_call_analytics_webhooks/migration.sql`.
It runs correctly as one transaction — pgAdmin's default — on PostgreSQL 12+,
which both servers exceed (17 and 18.6).
