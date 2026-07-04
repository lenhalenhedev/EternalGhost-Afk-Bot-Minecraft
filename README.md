# EternalGhost — Production-Grade Hardened Minecraft AFK Bot

> A Discord-managed, multi-instance Minecraft AFK automation platform engineered for continuous uptime, autonomous in-world survival, and enterprise-grade defensive security. Every credential path, network handler, and lifecycle transition has been audited and hardened for unattended, long-running production deployment.

<p align="left">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D18.0.0-339933.svg?logo=node.js&logoColor=white" />
  <img alt="Security" src="https://img.shields.io/badge/security-hardened-brightgreen.svg" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-80%2B%20passing-success.svg" />
  <img alt="Build" src="https://img.shields.io/badge/build-passing-success.svg" />
  <img alt="Code Style" src="https://img.shields.io/badge/code%20style-prettier-ff69b4.svg" />
</p>

---

## Table of Contents

1. [Overview](#overview)
2. [Core Architectural Features](#core-architectural-features)
3. [Security Hardening & Audit Remediation](#security-hardening--audit-remediation)
4. [Directory Structure](#directory-structure)
5. [Installation & Configuration](#installation--configuration)
6. [Environment Variables](#environment-variables)
7. [Discord Command Reference](#discord-command-reference)
8. [The `buildEditPatch` Payload Semantics](#the-buildeditpatch-payload-semantics)
9. [Testing & Quality Assurance](#testing--quality-assurance)
10. [Operational Notes](#operational-notes)
11. [License](#license)

---

## Overview

**EternalGhost** is a headless Minecraft automation system that maintains persistent player presence on Java Edition servers without human supervision. It is operated entirely through Discord slash commands, supports many concurrent bot identities from a single process, and persists all state to PostgreSQL.

The platform is built for three non-negotiable properties:

- **Automation** — Autonomous anti-AFK movement, hunger management, and defensive combat keep an account alive indefinitely.
- **Stability** — A strict per-bot state machine, bounded task queues, exponential-backoff reconnection, and exhaustive lifecycle teardown eliminate resource leaks over multi-week runtimes.
- **Security** — AuthMe credentials are encrypted with AES-256-GCM, handled exclusively through zeroized buffers, and every external payload is validated against injection and prototype-pollution attacks before it can reach persistence or the network.

---

## Core Architectural Features

### Networking & Protocol Layer

- **Mineflayer transport** — Each bot is a fully managed `mineflayer` client with configurable protocol version, view distance, and connection timeouts.
- **Pathfinding** — `mineflayer-pathfinder` is dynamically loaded per connection for goal-driven movement and stuck-detection recovery.
- **Connection isolation** — Low-level client construction and credential decryption are isolated in a dedicated connector, keeping the orchestrator free of protocol and cryptographic detail.

### Discord Control Plane

- **Fourteen slash commands** covering the complete bot lifecycle: creation, editing, deletion, start/stop/restart, live chat relay, log inspection, status, aggregate statistics, and per-user bot selection.
- **Role-restricted execution** — Every command is gated behind an administrator allowlist.
- **Structured embeds & audit notifications** — Success/error embeds, per-bot alerts, an audit channel for mutating operations, and periodic log summaries dispatched on a cron schedule.

### Lifecycle Management

- **Deterministic state machine** — `OFFLINE → CONNECTING → AUTHENTICATING → PLAYING → AFK → COMBAT`, with explicit `DISCONNECTED`, `RECONNECTING`, and `ERROR` terminal handling.
- **Bounded work queues** — Per-bot serialized task queues with configurable depth and per-task timeouts prevent command floods and stuck operations.
- **Resilient reconnection** — Exponential backoff with a rolling attempt window, duplicate-login backoff, and a hard reconnect ceiling that fails safe into `ERROR`.
- **Central orchestration** — A singleton `BotManager` owns registration, persistence synchronization, key rotation on boot, and graceful shutdown of all instances.

### Autonomous In-World Behaviors

- **Anti-AFK with dynamic radius** — Randomized wander targets within a configurable min/max radius, safe-spot selection that rejects hazardous blocks (lava, fire, cactus, magma, berry bushes, wither roses), stuck-timeout recovery, and periodic look rotation.
- **Auto-Eat** — Threshold-driven hunger management with cooldown control and combat-aware suspension.
- **Combat Engagement** — Hostile-mob scanning within range, a curated attack whitelist, an explicit blacklist for high-risk mobs (creeper, enderman, warden, ghast), best-weapon hotbar selection, retreat-on-low-HP logic, and invisibility timeouts.
- **Inventory Management** — Automatic cleanup triggered on item collection.
- **Authentication Flow** — Pattern-based detection of AuthMe register/login prompts, success signals, and hard-failure conditions.

### Quality Signal

- **80+ automated tests passing** across encryption, validators, queue semantics, state definitions, subsystem and combat leak detection, safe-spot selection, weapon scoring, log buffering, and authentication pattern matching.

---

## Security Hardening & Audit Remediation

> The repository has undergone a comprehensive security audit and refactoring. The vulnerability classes below — password mutation, prototype pollution, log injection, memory leaks, and weak cryptographic validation — have each been fully remediated and are covered by regression tests.

### 1. Cryptography

Credential encryption uses **AES-256-GCM**, an authenticated cipher that guarantees both confidentiality and integrity.

- **Strict key validation** — Every key is validated against `^[0-9a-fA-F]{64}$` (exactly 32 bytes) before any cryptographic operation. Malformed keys are rejected immediately rather than silently truncated or padded.
- **IV and authentication-tag integrity** — On decryption, the 12-byte IV, 16-byte auth tag, and non-empty ciphertext lengths are verified before the cipher is initialized. Any deviation is rejected as a malformed payload.
- **Generic error suppression** — The `encrypt()` routine is wrapped in `try/catch`; internal cryptographic failures are never surfaced. Callers receive only a generic `Credential encryption failed` error, preventing stack-trace and internal-state disclosure.
- **Versioned payloads & key rotation** — Ciphertext is stored as `v1:<fingerprint>:<iv>:<tag>:<ciphertext>`. A short key fingerprint enables transparent rotation: payloads encrypted under a previous key are detected and flagged for re-encryption without ever persisting the key material itself.

### 2. Memory Security

- **Buffer-only credential pipeline** — Plaintext passwords are converted to `Buffer` instances at the record-factory boundary and passed to the cipher as bytes rather than immutable, long-lived JavaScript strings.
- **Mandatory zeroization** — Every working buffer (plaintext copy and derived key material) is wiped with `.fill(0)` inside a `finally` block, guaranteeing the RAM footprint is cleared even when an exception is thrown mid-operation.
- **Decrypted-secret lifetime minimization** — In-memory decrypted passwords are cleared on every disconnect and teardown, so a live secret never outlives the connection that required it.

### 3. Injection & Pollution Immunity

- **Recursive prototype-pollution scanner** — All externally supplied payloads (Discord command options, JSON, and database records) are recursively scanned. Any object carrying `__proto__`, `constructor`, or `prototype` as an own key is rejected before it can reach validation, merging, or persistence. Cyclic references are handled safely.
- **Log injection stripping** — All user-controlled values are sanitized before logging; carriage returns, line feeds, and tabs (`/[\r\n\t]/g`) are collapsed to spaces, defeating forged log lines and log-file corruption.
- **In-game command injection defense** — Chat relay rejects whitespace and control characters in credentials and enforces an in-game command whitelist, preventing `/login`-token splitting and unauthorized command execution.

### 4. Runtime Hardening

- **Immutable configuration** — Subsystem defaults and tuning constants are sealed with `Object.freeze()`, preventing accidental or malicious mutation of runtime behavior.
- **Strict type and integer whitelisting** — Ports, view distance, and numeric intervals are validated with strict integer checks (`Number.isInteger`, bounded ranges) instead of permissive `parseInt`. Booleans are type-checked explicitly; truthy or coerced values are rejected.
- **Host and username whitelisting** — Hostnames are validated via `net.isIP()` combined with an RFC-compliant hostname pattern; malformed dotted-quads are rejected. Usernames are constrained to `^[A-Za-z0-9_]{3,16}$` with explicit rejection of Unicode and control characters.
- **Failsafe network packet isolation** — Every mineflayer event handler is wrapped in a guard that contains synchronous throws and rejected promises. A malformed or malicious packet triggers a generic log entry and an immediate `bot.end()`, ensuring a hostile server cannot escalate a bad packet into an unhandled rejection that unwinds the Node.js event loop.

### 5. Lifecycle Leak Prevention

- **Complete teardown** — On disconnect, stop, and destroy, all mineflayer listeners are removed, the respawn handler is detached, and the client is ended and quit.
- **Timer and controller cleanup** — Login timers, settle timers, reconnect timers, subsystem intervals, and the per-connection `AbortController` are cleared and nulled on every teardown path.
- **Reference nulling** — On permanent destruction, subsystem, queue, auth, reconnect, and controller references are set to `null` to release the entire object graph for garbage collection.
- **Bounded history** — Reconnect attempt history is pruned to its rolling window on every access, preventing unbounded growth over multi-week uptimes.

---

## Directory Structure

```text
EternalGhost-Afk-Bot-Minecraft/
├── index.js                          Application entrypoint; boots Discord client and BotManager
├── deploy-commands.js                Registers Discord slash commands with the guild/global API
├── package.json                      Project manifest, scripts, and dependency pins
├── eslint.config.mjs                 Flat ESLint configuration
├── .prettierrc                       Formatting rules
├── .env.example                      Annotated environment-variable template
├── POSTGRES_MIGRATION.md             Guide for the legacy JSON-to-PostgreSQL migration
├── db/
│   └── schema.sql                    PostgreSQL schema (bots, per-bot config, activity log)
├── scripts/
│   └── migrateJsonToPg.js            One-off importer from the legacy JSON store
├── src/
│   ├── config/
│   │   ├── index.js                  Validated env loader; enforces hex-key format and admin allowlist
│   │   └── database.js               PostgreSQL connection pool construction and TLS options
│   ├── services/
│   │   ├── encryption.js             AES-256-GCM encrypt/decrypt, key fingerprinting, rotation checks
│   │   ├── logger.js                 Winston logger, rotating files, sanitized per-bot log wrappers
│   │   └── logBuffer.js              In-memory ring buffers, summary aggregation, alert cooldowns
│   ├── manager/
│   │   ├── BotManager.js             Singleton orchestrator: registry, lifecycle, cron, shutdown
│   │   ├── botRecordFactory.js       Builds/validates records; buildNewRecord and buildEditPatch
│   │   ├── botRepository.js          Data-access layer over the persistence adapter
│   │   ├── Persistence.js            Load/save/rotate persistence coordination
│   │   ├── persistenceHelpers.js     Serialization and record-shaping helpers
│   │   ├── instanceEvents.js         Wires BotInstance events to Discord notifications
│   │   ├── managerStats.js           Aggregate fleet statistics computation
│   │   ├── DiscordNotifier.js        Alert, audit, and log-summary dispatch to Discord
│   │   └── Queue.js                  Bounded, timeout-aware per-bot task queue
│   ├── bot/
│   │   ├── BotInstance.js            Per-bot state machine and lifecycle owner
│   │   ├── subsystems.js             Idempotent lifecycle for gameplay subsystems
│   │   ├── phaseController.js        PLAYING and AFK phase transition logic
│   │   ├── states.js                 Frozen state enum and state-set membership helpers
│   │   ├── botSnapshot.js            Serializable read-model of a live bot
│   │   ├── AntiAFK.js                Anti-AFK controller (wander, rotate, stuck recovery)
│   │   ├── AutoEat.js                Threshold-based hunger management
│   │   ├── Combat.js                 Hostile-mob scanning and engagement loop
│   │   ├── Inventory.js              Automatic inventory cleanup
│   │   ├── antiafk/
│   │   │   ├── antiAfkConfig.js      Frozen anti-AFK constants and danger-block detection
│   │   │   ├── movement.js           Movement primitives and goal helpers
│   │   │   └── safeSpot.js           Safe-destination scoring and selection
│   │   ├── combat/
│   │   │   ├── combatConfig.js       Frozen combat constants, mob whitelist/blacklist
│   │   │   └── weapons.js            Weapon scoring and best-hotbar-slot selection
│   │   ├── auth/
│   │   │   ├── authFlow.js           AuthMe register/login orchestration
│   │   │   └── authPatterns.js       Prompt, success, and hard-failure pattern matching
│   │   └── connection/
│   │       ├── connector.js          Mineflayer client construction and password decryption
│   │       ├── botEventBinder.js     Guarded binding of all mineflayer event handlers
│   │       └── reconnectPolicy.js    Exponential backoff, attempt windowing, timer management
│   ├── discord/
│   │   ├── client.js                 Discord.js client factory and command loading
│   │   ├── embeds.js                 Shared success/error/status embed builders
│   │   ├── commands/                 One module per slash command (see reference below)
│   │   └── events/
│   │       ├── interactionCreate.js  Slash-command dispatch and permission gating
│   │       └── ready.js              Startup handler; binds the client to BotManager
│   └── utils/
│       ├── security.js               Prototype-pollution scanner, log sanitizer, strict-int guard
│       ├── validators.js             Host, port, username, version, password, chat validators
│       └── helpers.js                Pure utilities: timing, clamping, backoff, formatting
└── tests/                            Node.js test suite (80+ tests) and leak-detection kit
```

---

## Installation & Configuration

### Prerequisites

| Requirement    | Version / Notes                                             |
| -------------- | ---------------------------------------------------------- |
| Node.js        | `>= 18.0.0` (LTS recommended; native test runner required) |
| npm            | `>= 9` (bundled with Node.js 18+)                          |
| PostgreSQL     | `>= 13` reachable via `DATABASE_URL` or discrete `PG*` vars |
| Discord App    | Bot token, application (client) ID, and a target guild     |

### 1. Clone the repository

```bash
git clone https://github.com/your-org/EternalGhost-Afk-Bot-Minecraft.git
cd EternalGhost-Afk-Bot-Minecraft
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Generate a cryptographically secure 32-byte encryption key and paste it into `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Provision the database schema

```bash
npm run db:schema
```

> If migrating from a legacy JSON store, run `npm run db:migrate` after configuring `DATA_FILE`.

### 5. Register Discord slash commands

```bash
node deploy-commands.js
```

### 6. Run the test suite

```bash
npm test
```

### 7. Start the application

```bash
npm start
# or, for auto-restart during development:
npm run dev
```

---

## Environment Variables

All variables are declared in `.env.example`. The loader in `src/config/index.js` validates required values on boot and terminates immediately with a descriptive error if any are missing or malformed.

### Discord

| Variable                    | Required | Description                                                       |
| --------------------------- | :------: | ---------------------------------------------------------------- |
| `DISCORD_TOKEN`             |   Yes    | Bot token used to authenticate the gateway connection.           |
| `DISCORD_CLIENT_ID`         |   Yes    | Application (client) ID used for slash-command registration.     |
| `DISCORD_GUILD_ID`          |    No    | Target guild for instant command registration; empty = global.  |
| `DISCORD_ALERT_CHANNEL_ID`  |    No    | Channel receiving per-bot system alerts.                         |
| `DISCORD_AUDIT_CHANNEL_ID`  |    No    | Channel receiving audit entries for create/edit/delete actions.  |
| `DISCORD_LOG_CHANNEL_ID`    |    No    | Channel receiving bug/error log summaries.                       |

### Access Control

| Variable          | Required | Description                                                                 |
| ----------------- | :------: | -------------------------------------------------------------------------- |
| `ADMIN_USER_IDS`  |   Yes    | Comma-separated Discord user IDs permitted to invoke commands (no spaces).  |

### Encryption & Key Rotation

| Variable              | Required | Description                                                                                          |
| --------------------- | :------: | -------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`      |   Yes    | 64-character hex string (32 bytes) for the active AES-256-GCM key. Validated strictly on boot.       |
| `OLD_ENCRYPTION_KEY`  |    No    | Previous 64-character hex key. When set, stored passwords are auto-re-encrypted under the new key.   |

> **Rotation logic.** To rotate keys, generate a new `ENCRYPTION_KEY`, move the current value to `OLD_ENCRYPTION_KEY`, and restart. On boot, `BotManager` detects payloads whose fingerprint matches `OLD_ENCRYPTION_KEY`, transparently decrypts them, and re-encrypts under the new active key. Once all records report zero rotations remaining, `OLD_ENCRYPTION_KEY` may be removed.

### Database (PostgreSQL)

| Variable                          | Required | Description                                                            |
| --------------------------------- | :------: | -------------------------------------------------------------------- |
| `DATABASE_URL`                    |    No*   | Full connection string; takes precedence over discrete `PG*` values. |
| `PGHOST` / `PGPORT`               |    No*   | Host and port (used when `DATABASE_URL` is empty).                    |
| `PGUSER` / `PGPASSWORD`           |    No*   | Database credentials.                                                 |
| `PGDATABASE`                      |    No*   | Target database name.                                                 |
| `DB_SSL`                          |    No    | Set `true` to enable TLS for managed Postgres providers.             |
| `DB_SSL_REJECT_UNAUTHORIZED`      |    No    | Set `false` to accept self-signed certificates.                     |
| `DB_POOL_MAX` / `DB_POOL_MIN`     |    No    | Connection-pool sizing.                                              |
| `DB_POOL_IDLE_TIMEOUT_MS`         |    No    | Idle connection eviction timeout.                                    |
| `DB_POOL_CONNECTION_TIMEOUT_MS`   |    No    | Connection acquisition timeout.                                     |

> *At least one of `DATABASE_URL` or the discrete `PG*` set must be provided.

### Storage & Operational Limits

| Variable                    | Default            | Description                                                     |
| --------------------------- | ------------------ | ------------------------------------------------------------- |
| `DATA_FILE`                 | `./data/bots.json` | Legacy JSON path used only by the migration script.           |
| `LOG_DIR`                   | `./logs`           | Directory for rotating log files.                            |
| `LOG_LEVEL`                 | `info`             | Winston log level.                                          |
| `MAX_BOTS`                  | `50`               | Maximum concurrent bot instances.                          |
| `BOT_QUEUE_SIZE`            | `100`              | Per-bot task-queue depth.                                   |
| `BOT_QUEUE_TIMEOUT`         | `10000`            | Per-task timeout in milliseconds.                          |
| `LOG_SUMMARY_INTERVAL_MIN`  | `15`               | Discord log-summary cadence in minutes (bounded 10–30).     |
| `MINECRAFT_VIEW_DISTANCE`   | `4`                | Requested chunk view distance (bounded 2–16).              |

---

## Discord Command Reference

All commands are ephemeral, administrator-gated, and respond with structured embeds.

| Command        | Options                                                | Description                                                             |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `/create-bot`  | `host`, `port`, `username`, `version`, `password?`, `auto-reconnect?` | Creates and persists a new validated bot record.        |
| `/edit-bot`    | `id`, `host?`, `port?`, `version?`, `password?`, `auto-reconnect?`    | Applies a partial, validated patch to an existing record.|
| `/delete-bot`  | `id`                                                  | Destroys the instance, clears in-memory state, and removes the record. |
| `/start`       | `id`                                                  | Starts a bot and marks it as running for auto-restart.                 |
| `/stop`        | `id`, `force?`                                        | Stops a bot and clears the running flag.                              |
| `/restart`     | `id`                                                  | Stops, pauses briefly, and restarts a bot.                           |
| `/chat`        | `message`, `id?`                                      | Relays a validated chat message or whitelisted in-game command.       |
| `/list-bot`    | `page?`                                               | Lists registered bots with pagination.                               |
| `/status-bot`  | `id`                                                  | Shows detailed live status for a single bot.                         |
| `/stats`       | —                                                     | Displays aggregate fleet statistics.                                |
| `/logs-bot`    | `id`, `lines?`, `hours?`, `level?`                    | Returns recent buffered logs filtered by count, age, and level.       |
| `/select-bot`  | `id`                                                  | Sets the caller's default bot for commands that omit `id`.            |
| `/help`        | —                                                     | Lists available commands and usage.                                 |

> **Chat safety.** The `/chat` command enforces a 200-character limit, a per-user cooldown, control-character rejection, and an in-game command whitelist (`/register`, `/login`, `/spawn`, `/home`, `/back`). Non-whitelisted slash commands are refused.

---

## The `buildEditPatch` Payload Semantics

`buildEditPatch(record, patch)` in `src/manager/botRecordFactory.js` is the single, secure entrypoint for partial bot modifications. It guarantees that an edit can never bypass validation and — critically — that omitting a field does not silently destroy existing data.

### Processing pipeline

1. **Prototype-pollution scan.** The incoming `patch` is recursively scanned; presence of `__proto__`, `constructor`, or `prototype` as own keys aborts the operation.
2. **Explicit-presence detection.** A field is considered "provided" only when it is an own property of `patch` and is neither `undefined` nor `null`.
3. **Validated merge.** The patch is merged onto the existing record and the *merged* configuration is fully re-validated, so a partial edit cannot produce an invalid combined state. The immutable `username` is always sourced from the existing record.
4. **Allowlisted output.** Only recognized fields (`host`, `port`, `version`, `autoReconnect`, `encryptedPassword`, `updatedAt`) are emitted. Ports pass strict integer validation; `autoReconnect` is rejected unless it is a genuine boolean.

### Password preservation (the mutation-bug fix)

> Historically, an omitted password during an edit defaulted to an empty string, silently wiping the stored credential. This is fully remediated.

The password participates in validation, merging, and re-encryption **only when it is explicitly provided** in the patch:

```js
const passwordProvided =
  Object.prototype.hasOwnProperty.call(patch, 'password') &&
  patch.password !== undefined &&
  patch.password !== null;
```

| Scenario                             | Behavior                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `password` absent from patch          | Existing `encryptedPassword` is untouched and preserved.               |
| `password` present and non-empty      | Validated, encrypted via a zeroized buffer, and written to the record. |
| `password` present and empty string   | Validated as an intentional offline credential; no ciphertext written. |

When a new password is supplied, it is converted to a `Buffer`, encrypted, and the buffer is wiped with `.fill(0)` in a `finally` block so the plaintext never lingers in memory.

---

## Testing & Quality Assurance

The suite runs on the native Node.js test runner and requires no additional test framework.

```bash
npm test
```

Coverage spans:

- **Cryptography** — round-trip correctness, unique IVs, tamper detection, key-rotation flagging, and malformed-payload rejection.
- **Validators** — host, port, username, version, password, chat message, and admin checks.
- **Concurrency** — queue ordering, timeouts, overflow, and drain/reset semantics.
- **Leak detection** — subsystem and combat interval-timer accounting across respawn and phase churn.
- **Behavioral units** — safe-spot selection, weapon scoring, state definitions, log buffering, and authentication pattern matching.

Linting and formatting:

```bash
npm run lint
npm run format
```

---

## Operational Notes

- **Graceful shutdown.** `BotManager.shutdown()` stops the cron summary task, stops every bot, and flushes persistence, ensuring no orphaned timers or in-flight writes on process exit.
- **Auto-restart.** Bots flagged as running are automatically restarted on boot, restoring the fleet to its last known operational state.
- **Offline-mode servers.** Bots connect in `offline` authentication mode; AuthMe login is handled in-world via the authentication flow when a prompt is detected.
- **Observability.** Rotating file logs, an in-memory ring buffer per bot, alert cooldowns, and periodic Discord summaries provide layered visibility without unbounded memory growth.

---

## License

Distributed under the MIT License. See `LICENSE` for full terms.
