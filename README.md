# Discord Minecraft AFK Bot System

A system to manage multiple Minecraft AFK bots simultaneously via Discord Slash Commands.

## Features

| Feature               | Details                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| **Multi-bot**         | Manage up to 50 bots simultaneously                                                     |
| **State Machine**     | OFFLINE -> CONNECTING -> AUTHENTICATING -> PLAYING -> AFK <-> COMBAT                    |
| **AuthMe Auto-Login** | Auto /register and /login with random 3-5s delay, retries 4 times                       |
| **Anti-AFK**          | Random movement within 5-10 block radius, avoids lava/void/gap, stuck detection         |
| **Combat**            | Attacks zombie/skeleton/spider, ignores creeper/enderman/warden, retreats when HP < 30% |
| **Auto-Eat**          | Eats when food < 14, prioritizes cooked food, disables during combat                    |
| **Inventory**         | Auto drops junk (dirt, cobblestone...) when full >= 90%, protects diamond/netherite     |
| **Auto-Reconnect**    | Exponential backoff 5s -> 30s -> 60s -> 90s -> 120s, max 5 times/10 mins                |
| **Persistence**       | Saves to JSON, auto restarts wasRunning=true on Node.js reboot                          |
| **AES-256-GCM**       | Encrypts passwords with random IV + supports Key Rotation                               |
| **Discord Alerts**    | Death, Disconnect, Login Fail, No Food — cooldown 45s/type                              |
| **Audit Log**         | Logs create/delete/edit with UserID + Timestamp                                         |
| **Log Summary**       | Sends log summary to Discord every N minutes (configurable)                             |

## Requirements

- **Node.js** >= 18.0.0
- **Discord Bot Token** (from Discord Developer Portal)
- Discord Application with Slash Commands enabled

## Installation

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd discord-minecraft-afk-bots
npm install

```

### 2. Create .env file

```bash
cp .env.example .env

```

Edit .env:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_guild_id          # leave empty for global deploy
DISCORD_ALERT_CHANNEL_ID=channel_id     # alert channel
DISCORD_AUDIT_CHANNEL_ID=channel_id     # audit log channel

ADMIN_USER_IDS=your_discord_user_id

# Generate encryption key:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_64_char_hex_key

```

### 3. Create data directories

```bash
mkdir -p data logs

```

### 4. Deploy Slash Commands (Run once)

```bash
node deploy-commands.js

```

### 5. Start

```bash
node index.js
# or
npm start

```

## Usage Guide

### Create your first bot

```
/create-bot host:mc.example.com port:25565 username:MyBot version:1.20.4 password:secret123

```

### Select a bot to control

```
/select-bot id:abc12345

```

### Start bot

```
/start

```

### Check status

```
/status-bot

```

### Send chat in-game

```
/chat message:Hello World!

```

### View logs

```
/logs-bot lines:50 hours:1 level:ERROR

```

## Directory Structure

```
discord-minecraft-afk-bots/
├── index.js
├── deploy-commands.js
├── .env.example
├── package.json
├── data/
│   └── bots.json
├── logs/
│   ├── combined-YYYY-MM-DD.log
│   └── error-YYYY-MM-DD.log
└── src/
    ├── config/
    │   └── index.js
    ├── services/
    │   ├── encryption.js
    │   └── logger.js
    ├── utils/
    │   ├── helpers.js
    │   └── validators.js
    ├── bot/
    │   ├── states.js
    │   ├── BotInstance.js
    │   ├── AntiAFK.js
    │   ├── Combat.js
    │   ├── Inventory.js
    │   └── AutoEat.js
    ├── manager/
    │   ├── BotManager.js
    │   ├── Queue.js
    │   └── Persistence.js
    └── discord/
        ├── client.js
        ├── embeds.js
        ├── events/
        │   ├── ready.js
        │   └── interactionCreate.js
        └── commands/
            ├── create-bot.js
            ├── delete-bot.js
            ├── status-bot.js
            ├── list-bot.js
            ├── select-bot.js
            ├── edit-bot.js
            ├── start.js
            ├── stop.js
            ├── restart.js
            ├── chat.js
            ├── logs-bot.js
            ├── stats.js
            └── help.js

```

## Security

### Password Encryption

All Minecraft passwords are encrypted using **AES-256-GCM** featuring:

- Random 12-byte IV per encryption
- 16-byte Auth tag (anti-tamper)
- Key fingerprint for key rotation detection
  Payload format: v1:<fp8>:<ivHex>:<tagHex>:<cipherHex>

### Key Rotation

When changing ENCRYPTION_KEY, place the old key into OLD_ENCRYPTION_KEY. On startup, the system automatically re-encrypts all passwords to the new key.

```env
ENCRYPTION_KEY=new_64_char_hex_key
OLD_ENCRYPTION_KEY=old_64_char_hex_key

```

### Access Control

Only Discord User IDs listed in ADMIN_USER_IDS can use the commands. All other requests are instantly rejected.

## Advanced Configuration

| Env Var                  | Default          | Description                               |
| ------------------------ | ---------------- | ----------------------------------------- |
| MAX_BOTS                 | 50               | Maximum bot limit                         |
| BOT_QUEUE_SIZE           | 100              | Max task queue per bot                    |
| BOT_QUEUE_TIMEOUT        | 10000            | Task timeout (ms)                         |
| LOG_SUMMARY_INTERVAL_MIN | 15               | Log summary interval to Discord (minutes) |
| LOG_LEVEL                | info             | Winston log level                         |
| LOG_DIR                  | ./logs           | Directory to store logs                   |
| DATA_FILE                | ./data/bots.json | Storage file for bot config               |

## State Machine

```
OFFLINE
  │ /start
  ▼
CONNECTING ──────────────────────────────────────────┐
  │ spawn                                             │
  ▼                                                   │
AUTHENTICATING (/login, /register)                    │ error/kick
  │ auth success                                      │
  ▼                                                   │
PLAYING (settle 3s)                                   │
  │                                                   │
  ▼                                                   │
AFK ◄──────── COMBAT                                  │
  │ (anti-AFK)  (mob attack)                         │
  │                                                   │
  └── error/kick/end ──► DISCONNECTED                 │
                              │ autoReconnect=false    │
                              │ autoReconnect=true     │
                              ▼                        │
                         RECONNECTING ────────────────►┘
                              │ limit reached
                              ▼
                           ERROR

```

## Troubleshooting

**Bot fails to connect?**

- Check host, port, version with /status-bot
- View logs with /logs-bot level:ERROR
- Ensure the server is online and the version matches
  **AuthMe password not working?**
- Make sure you provided a password during bot creation with /create-bot password:...
- Check logs to see what prompt the server is sending
  **Slash commands not appearing?**
- Run node deploy-commands.js
- Guild commands appear instantly. Global commands take up to 1 hour
- Ensure the bot has applications.commands permission in the guild
  **Error "No matching key for fingerprint"?**
- Put the old key into OLD_ENCRYPTION_KEY for rotation
- If the key is completely lost: delete data/bots.json and recreate the bots
  **RAM usage too high?**
- Each bot takes ~100-200MB heap. 50 bots = ~5-10GB RAM
- Check /stats for estimates
- Reduce MAX_BOTS in .env

## License

MIT
Created with ❤️ lenhalenhedev
