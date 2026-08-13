-- ============================================================================
--  PostgreSQL schema for the Discord-managed Minecraft AFK bot system
-- ----------------------------------------------------------------------------
--  Design notes
--  * One "bots" row per managed bot. Sensitive credentials stay encrypted at
--    the application layer (AES-256-GCM); the DB only ever stores the opaque
--    ciphertext payload.
--  * Per-bot subsystem tuning lives in dedicated 1:1 config tables
--    (anti-AFK / auto-eat / combat) so each subsystem can evolve independently
--    without bloating the core row.
--  * "hidden" gives the visible/hidden flag; "bot_activity_log" is the
--    append-only activity history.
--  * Run this file once against a fresh database:
--        psql "$DATABASE_URL" -f db/schema.sql
--    It is idempotent (IF NOT EXISTS), so re-running is safe.
-- ============================================================================

BEGIN;

-- Needed for gen_random_uuid(). pgcrypto ships with every modern Postgres.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Core bot record ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bots (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    host               TEXT         NOT NULL,
    port               INTEGER      NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username           TEXT         NOT NULL,
    -- AES-256-GCM payload produced by src/services/encryption.js. Empty string
    -- means "no password" (offline / no-auth servers). Never store plaintext.
    encrypted_password TEXT         NOT NULL DEFAULT '',
    version            TEXT         NOT NULL,
    auto_reconnect     BOOLEAN      NOT NULL DEFAULT TRUE,
    -- true  => bot should be auto-started after a process reboot
    was_running        BOOLEAN      NOT NULL DEFAULT FALSE,
    -- visible/hidden flag (hidden bots are kept but excluded from default lists)
    hidden             BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by         TEXT         NOT NULL,                 -- Discord user id
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Uniqueness guard mirrors Persistence.findBot(host, port, username)
    CONSTRAINT bots_host_port_username_key UNIQUE (host, port, username)
);

-- ─── Anti-AFK configuration (1:1 with bots) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_antiafk_config (
    bot_id            UUID    PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    min_radius        INTEGER NOT NULL DEFAULT 5,
    max_radius        INTEGER NOT NULL DEFAULT 10,
    min_interval      INTEGER NOT NULL DEFAULT 5000,
    max_interval      INTEGER NOT NULL DEFAULT 15000,
    max_retries       INTEGER NOT NULL DEFAULT 3,
    move_timeout      INTEGER NOT NULL DEFAULT 20000,
    stuck_timeout     INTEGER NOT NULL DEFAULT 12000,
    rotation_interval INTEGER NOT NULL DEFAULT 3000
);

-- ─── Auto-eat configuration (1:1 with bots) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_autoeat_config (
    bot_id         UUID    PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    eat_threshold  INTEGER NOT NULL DEFAULT 14,   -- eat when food < threshold /20
    eat_cooldown   INTEGER NOT NULL DEFAULT 1500, -- ms between eat attempts
    check_interval INTEGER NOT NULL DEFAULT 3000  -- ms between hunger checks
);

-- ─── Combat configuration (1:1 with bots) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_combat_config (
    bot_id              UUID    PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    scan_range          INTEGER NOT NULL DEFAULT 15,
    engage_range        INTEGER NOT NULL DEFAULT 4,
    max_combat_duration INTEGER NOT NULL DEFAULT 12000,
    retreat_hp_pct      REAL    NOT NULL DEFAULT 0.3,
    scan_interval       INTEGER NOT NULL DEFAULT 1000,
    attack_interval     INTEGER NOT NULL DEFAULT 600,
    invisible_timeout   INTEGER NOT NULL DEFAULT 3000
);

-- ─── User → selected bot (replaces userSelections map) ──────────────────────
CREATE TABLE IF NOT EXISTS user_selections (
    user_id    TEXT        PRIMARY KEY,                       -- Discord user id
    bot_id     UUID        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Activity history (append-only audit trail per bot) ─────────────────────
CREATE TABLE IF NOT EXISTS bot_activity_log (
    id         BIGSERIAL   PRIMARY KEY,
    -- nullable + ON DELETE SET NULL so history survives bot deletion
    bot_id     UUID        REFERENCES bots(id) ON DELETE SET NULL,
    action     TEXT        NOT NULL,        -- e.g. created | started | stopped
    actor      TEXT,                        -- Discord user id (nullable)
    meta       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_activity_log_bot_id_created_at_idx
    ON bot_activity_log (bot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_selections_bot_id_idx
    ON user_selections (bot_id);

COMMIT;
