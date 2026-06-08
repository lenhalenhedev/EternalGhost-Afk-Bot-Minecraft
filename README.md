# 🎮 Discord Minecraft AFK Bot System

Hệ thống quản lý nhiều bot Minecraft AFK cùng lúc thông qua **Discord Slash Commands**.

---

## ✨ Tính năng

| Tính năng | Chi tiết |
|-----------|----------|
| **Multi-bot** | Quản lý tối đa 50 bot cùng lúc |
| **State Machine** | OFFLINE→CONNECTING→AUTHENTICATING→PLAYING→AFK↔COMBAT |
| **AuthMe Auto-Login** | Tự `/register` và `/login` với delay ngẫu nhiên 3-5s, thử lại 4 lần |
| **Anti-AFK** | Di chuyển ngẫu nhiên bán kính 5-10 block, tránh lava/void/gap, stuck detection |
| **Combat** | Tấn công zombie/skeleton/spider, bỏ qua creeper/enderman/warden, retreat khi HP < 30% |
| **Auto-Eat** | Ăn khi food < 14, ưu tiên cooked food, không ăn trong combat |
| **Inventory** | Tự drop junk (dirt, cobblestone...) khi đầy ≥ 90%, bảo vệ diamond/netherite |
| **Auto-Reconnect** | Exponential backoff 5s→30s→60s→90s→120s, tối đa 5 lần/10 phút |
| **Persistence** | Lưu JSON, tự restart `wasRunning=true` khi khởi động lại Node.js |
| **AES-256-GCM** | Mã hóa mật khẩu với IV ngẫu nhiên + hỗ trợ Key Rotation |
| **Discord Alerts** | Death, Disconnect, Login Fail, No Food — cooldown 45s/type |
| **Audit Log** | Ghi lại create/delete/edit với UserID + Timestamp |
| **Log Summary** | Tóm tắt gửi về Discord mỗi N phút (cấu hình được) |

---

## 📋 Yêu cầu

- **Node.js** >= 18.0.0
- **Discord Bot Token** (từ [Discord Developer Portal](https://discord.com/developers/applications))
- Discord Application với Slash Commands enabled

---

## 🚀 Cài đặt

### 1. Clone và cài dependencies

```bash
git clone <repo-url>
cd discord-minecraft-afk-bots
npm install
```

### 2. Tạo file `.env`

```bash
cp .env.example .env
```

Chỉnh sửa `.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_guild_id          # để trống = global deploy
DISCORD_ALERT_CHANNEL_ID=channel_id     # channel nhận alerts
DISCORD_AUDIT_CHANNEL_ID=channel_id     # channel audit log

ADMIN_USER_IDS=your_discord_user_id

# Tạo encryption key:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_64_char_hex_key
```

### 3. Tạo thư mục dữ liệu

```bash
mkdir -p data logs
```

### 4. Deploy Slash Commands (chỉ cần chạy 1 lần)

```bash
node deploy-commands.js
```

### 5. Khởi động

```bash
node index.js
# hoặc
npm start
```

---

## 🎮 Hướng dẫn sử dụng

### Tạo bot đầu tiên

```
/create-bot host:mc.example.com port:25565 username:MyBot version:1.20.4 password:secret123
```

### Chọn bot để điều khiển

```
/select-bot id:abc12345
```

### Khởi động

```
/start
```

### Xem trạng thái

```
/status-bot
```

### Gửi chat vào game

```
/chat message:Hello World!
```

### Xem log

```
/logs-bot lines:50 hours:1 level:ERROR
```

---

## 📂 Cấu trúc thư mục

```
discord-minecraft-afk-bots/
├── index.js                      # Entry point
├── deploy-commands.js            # Script đăng ký slash commands
├── .env.example
├── package.json
├── data/
│   └── bots.json                 # Dữ liệu bot (auto-created)
├── logs/
│   ├── combined-YYYY-MM-DD.log  # All logs
│   └── error-YYYY-MM-DD.log     # Error only
└── src/
    ├── config/
    │   └── index.js              # Env validation & config object
    ├── services/
    │   ├── encryption.js         # AES-256-GCM + key rotation
    │   └── logger.js             # Winston + per-bot buffers + alert cooldowns
    ├── utils/
    │   ├── helpers.js            # sleep, formatUptime, getReconnectDelay...
    │   └── validators.js         # validateVersion, validateBotConfig, isAdmin
    ├── bot/
    │   ├── states.js             # BOT_STATES enum + state sets + colors
    │   ├── BotInstance.js        # Core mineflayer state machine
    │   ├── AntiAFK.js            # Pathfinder random movement
    │   ├── Combat.js             # Mob detection + attack loop
    │   ├── Inventory.js          # Auto-drop junk, protect valuable
    │   └── AutoEat.js            # Hunger management
    ├── manager/
    │   ├── BotManager.js         # Singleton: create/delete/start/stop bots
    │   ├── Queue.js              # Per-bot async task queue
    │   └── Persistence.js        # JSON file read/write + key rotation
    └── discord/
        ├── client.js             # Discord.js client setup
        ├── embeds.js             # Shared embed builders
        ├── events/
        │   ├── ready.js          # Register commands, set presence
        │   └── interactionCreate.js  # Route commands + admin guard
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

---

## 🔐 Bảo mật

### Mã hóa mật khẩu

Mọi mật khẩu Minecraft đều được mã hóa bằng **AES-256-GCM** với:
- IV ngẫu nhiên 12 bytes mỗi lần encrypt
- Auth tag 16 bytes (chống tamper)
- Key fingerprint để phát hiện key rotation

Định dạng payload: `v1:<fp8>:<ivHex>:<tagHex>:<cipherHex>`

### Key Rotation

Khi đổi `ENCRYPTION_KEY`, đặt key cũ vào `OLD_ENCRYPTION_KEY`. Khi khởi động, hệ thống tự động re-encrypt tất cả mật khẩu sang key mới.

```env
ENCRYPTION_KEY=new_64_char_hex_key
OLD_ENCRYPTION_KEY=old_64_char_hex_key
```

### Kiểm soát quyền truy cập

Chỉ Discord User ID có trong `ADMIN_USER_IDS` mới dùng được lệnh. Mọi request khác bị từ chối ngay lập tức.

---

## ⚙️ Cấu hình nâng cao

| Env Var | Mặc định | Mô tả |
|---------|----------|-------|
| `MAX_BOTS` | `50` | Giới hạn số bot tối đa |
| `BOT_QUEUE_SIZE` | `100` | Queue task tối đa/bot |
| `BOT_QUEUE_TIMEOUT` | `10000` | Timeout/task (ms) |
| `LOG_SUMMARY_INTERVAL_MIN` | `15` | Gửi tóm tắt log về Discord (phút) |
| `LOG_LEVEL` | `info` | Winston log level |
| `LOG_DIR` | `./logs` | Thư mục lưu log |
| `DATA_FILE` | `./data/bots.json` | File lưu trữ bot config |

---

## 🔄 State Machine

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

---

## 🐛 Troubleshooting

**Bot không kết nối được?**
- Kiểm tra `host`, `port`, `version` với `/status-bot`
- Xem log với `/logs-bot level:ERROR`
- Đảm bảo server đang chạy và version khớp

**Mật khẩu AuthMe không hoạt động?**
- Đảm bảo đã nhập password khi tạo bot với `/create-bot password:...`
- Kiểm tra log xem server gửi prompt gì

**Slash commands không hiện ra?**
- Chạy `node deploy-commands.js`
- Với guild commands: hiện ngay. Global: chờ tối đa 1 giờ
- Đảm bảo bot có quyền `applications.commands` trong guild

**Lỗi "No matching key for fingerprint"?**
- Đặt key cũ vào `OLD_ENCRYPTION_KEY` để rotation
- Nếu mất key hoàn toàn: xóa `data/bots.json` và tạo lại bot

**RAM quá cao?**
- Mỗi bot ~100-200MB heap. Với 50 bot = ~5-10GB RAM
- Kiểm tra `/stats` để xem estimation
- Giảm `MAX_BOTS` trong `.env`

---

## 📄 License

MIT

---

*Được tạo với ❤️ cho cộng đồng Minecraft Việt Nam*
