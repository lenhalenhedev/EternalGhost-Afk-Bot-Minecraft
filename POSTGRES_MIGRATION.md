# Migrating storage from `bots.json` to PostgreSQL

This document describes the conversion of the bot storage layer from a single
`bots.json` file to a PostgreSQL database, and the exact steps to set it up.

## What changed

| Area | Before | After |
|------|--------|-------|
| Storage | `data/bots.json` (one JSON blob) | PostgreSQL (`pg` connection pool) |
| Schema | implicit (JS object) | `db/schema.sql` (6 tables) |
| Connection | n/a | `src/config/database.js` (pooled) |
| Persistence | sync file read/write | sync in-memory cache + async write-behind to PG |
| Per-bot tuning | global constants only | per-bot `antiAfk` / `autoEat` / `combat` config rows |
| History | none | `bot_activity_log` (created/started/stopped/edited/deleted/migrated) |

### Why `pg` and not Prisma

The existing `Persistence` API is **synchronous** and is called all over
`BotManager.js` / `instanceEvents.js` without `await` (`saveBot`, `getBot`,
`findBot`, `updateBotState`, ...). Prisma's client is async-only and would force
a rewrite of every caller. Using `pg` we keep an **in-memory cache** as the
runtime source of truth (exactly like the old file cache) and **write-behind**
every mutation to Postgres through a serialised queue. This preserves the
original interface verbatim. `pg.Pool` also gives first-class connection
pooling, which was an explicit requirement.

Only two call sites needed a 1-line change (both kept backwards-safe):
- `await Persistence.load()` at startup (was sync).
- `await Persistence.flush()` on shutdown (replaces `flushSync()`, which is
  retained as a shim).

## Database schema (`db/schema.sql`)

- **`bots`** – core record: `id`, `host`, `port`, `username`,
  `encrypted_password` (AES-256-GCM payload, never plaintext), `version`,
  `auto_reconnect`, `was_running`, `hidden` (visible/hidden flag), `created_by`,
  `created_at`, `updated_at`. Unique on `(host, port, username)`.
- **`bot_antiafk_config`** – 1:1 anti-AFK tuning (radius, intervals, timeouts…).
- **`bot_autoeat_config`** – 1:1 auto-eat tuning (threshold, cooldown, interval).
- **`bot_combat_config`** – 1:1 combat tuning (ranges, retreat %, intervals…).
- **`user_selections`** – Discord user → currently selected bot.
- **`bot_activity_log`** – append-only activity history (JSONB `meta`).

All config/selection tables reference `bots(id)` with `ON DELETE CASCADE`, so
deleting a bot cleans up everything; activity rows use `ON DELETE SET NULL` so
history survives deletion.

## Setup steps

### 1. Provision PostgreSQL
```bash
# Local example
createdb afkbots
createuser botuser --pwprompt
psql -c "GRANT ALL PRIVILEGES ON DATABASE afkbots TO botuser;"
```
Managed Postgres (Supabase / Neon / RDS) also works – just grab the connection
string and set `DB_SSL=true`.

### 2. Configure environment
Copy `.env.example` to `.env` and fill in either `DATABASE_URL` **or** the
discrete `PG*` vars:
```
DATABASE_URL=postgres://botuser:botpass@localhost:5432/afkbots
# (optional pool tuning) DB_POOL_MAX=10, DB_SSL=true, ...
```

### 3. Install dependencies
```bash
npm install        # pulls in the new "pg" dependency
```

### 4. Create the schema
```bash
npm run db:schema        # = psql "$DATABASE_URL" -f db/schema.sql
# or manually:
psql "$DATABASE_URL" -f db/schema.sql
```
The script is idempotent (`CREATE TABLE IF NOT EXISTS`), so it is safe to re-run.

### 5. Migrate existing data (optional, only if you have a `bots.json`)
```bash
node scripts/migrateJsonToPg.js --dry-run   # preview, no writes
npm run db:migrate                          # actually import
# custom file: node scripts/migrateJsonToPg.js ./backup/bots.json
```
The migration copies encrypted passwords across **as-is** (it never decrypts),
so your existing `ENCRYPTION_KEY` keeps working. It UPSERTs by `id`, so it is
safe to re-run. Keep a backup of `bots.json` until you have verified the import.

### 6. Run
```bash
npm start
```
On boot the app connects to Postgres, hydrates the in-memory cache, optionally
rotates encryption keys, and auto-starts bots whose `was_running` is true –
identical behaviour to before.

## Notes & guarantees

- **Credentials stay encrypted.** Only the AES-256-GCM ciphertext is stored,
  exactly as produced by `src/services/encryption.js`. Key rotation
  (`OLD_ENCRYPTION_KEY`) still works and now persists per-row re-encryption.
- **Crash safety.** Writes are serialised in order; on shutdown
  `await Persistence.flush()` drains the queue before exit.
- **No interface breakage.** Discord command handlers and `BotManager` continue
  to call the same `Persistence` methods with the same arguments.
- **New capabilities** (optional to use): `Persistence.updateBotConfig(id,
  section, patch)`, `Persistence.logActivity(...)`, and
  `Persistence.getActivityHistory(botId, limit)`.
