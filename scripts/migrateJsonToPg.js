'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const db = require('../src/config/database');
const {
  DEFAULT_ANTIAFK,
  DEFAULT_AUTOEAT,
  DEFAULT_COMBAT,
} = require('../src/manager/botRecordFactory');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fileArg = args.find((a) => !a.startsWith('--'));

// --- FIX PATH TRAVERSAL TẠI ĐÂY ---
// Định nghĩa thư mục gốc an toàn là thư mục dự án (EternalGhost-Afk-Bot-Minecraft)
const ALLOWED_DIR = path.resolve(__dirname, '..');

// Tìm đường dẫn tuyệt đối của file đích
let TARGET_FILE = path.resolve(
  fileArg || process.env.DATA_FILE || './data/bots.json',
);

// Nếu người dùng chủ động truyền tham số, phải kiểm tra xem có đi lùi ra ngoài thư mục dự án không
if (fileArg && !TARGET_FILE.startsWith(ALLOWED_DIR)) {
  console.error('[migrate] FAILED: Địt mẹ mày định đi lùi thư mục để hack hệ thống à? Cút!');
  process.exit(1);
}

const DATA_FILE = TARGET_FILE;
// ---------------------------------

function log(...m) { console.log('[migrate]', ...m); }

function readJson() {
  if (!fs.existsSync(DATA_FILE)) {
    log(`No JSON file at ${DATA_FILE} – nothing to migrate.`);
    return { bots: {}, userSelections: {} };
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${DATA_FILE}: ${err.message}`);
  }
  return {
    bots: parsed.bots || {},
    userSelections: parsed.userSelections || {},
  };
}

function antiAfkOf(bot) { return { ...DEFAULT_ANTIAFK, ...(bot.antiAfk || {}) }; }
function autoEatOf(bot) { return { ...DEFAULT_AUTOEAT, ...(bot.autoEat || {}) }; }
function combatOf(bot)  { return { ...DEFAULT_COMBAT,  ...(bot.combat  || {}) }; }

async function insertBot(client, bot) {
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO bots
       (id, host, port, username, encrypted_password, version,
        auto_reconnect, was_running, hidden, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       host=$2, port=$3, username=$4, encrypted_password=$5, version=$6,
       auto_reconnect=$7, was_running=$8, hidden=$9, created_by=$10,
       created_at=$11, updated_at=$12`,
    [
      bot.id, bot.host, parseInt(bot.port, 10), bot.username,
      bot.encryptedPassword || '', bot.version,
      bot.autoReconnect !== undefined ? bot.autoReconnect : true,
      bot.wasRunning !== undefined ? bot.wasRunning : false,
      bot.hidden !== undefined ? bot.hidden : false,
      bot.createdBy || null,
      bot.createdAt || now, bot.updatedAt || now,
    ],
  );

  const a = antiAfkOf(bot);
  await client.query(
    `INSERT INTO bot_antiafk_config
       (bot_id, enabled, min_radius, max_radius, min_interval, max_interval,
        max_retries, move_timeout, stuck_timeout, rotation_interval)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (bot_id) DO UPDATE SET
       enabled=$2, min_radius=$3, max_radius=$4, min_interval=$5,
       max_interval=$6, max_retries=$7, move_timeout=$8, stuck_timeout=$9,
       rotation_interval=$10`,
    [bot.id, a.enabled, a.minRadius, a.maxRadius, a.minInterval, a.maxInterval,
     a.maxRetries, a.moveTimeout, a.stuckTimeout, a.rotationInterval],
  );

  const e = autoEatOf(bot);
  await client.query(
    `INSERT INTO bot_autoeat_config
       (bot_id, enabled, eat_threshold, eat_cooldown, check_interval)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (bot_id) DO UPDATE SET
       enabled=$2, eat_threshold=$3, eat_cooldown=$4, check_interval=$5`,
    [bot.id, e.enabled, e.eatThreshold, e.eatCooldown, e.checkInterval],
  );

  const c = combatOf(bot);
  await client.query(
    `INSERT INTO bot_combat_config
       (bot_id, enabled, scan_range, engage_range, max_combat_duration,
        retreat_hp_pct, scan_interval, attack_interval, invisible_timeout)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (bot_id) DO UPDATE SET
       enabled=$2, scan_range=$3, engage_range=$4, max_combat_duration=$5,
       retreat_hp_pct=$6, scan_interval=$7, attack_interval=$8,
       invisible_timeout=$9`,
    [bot.id, c.enabled, c.scanRange, c.engageRange, c.maxCombatDuration,
     c.retreatHpPct, c.scanInterval, c.attackInterval, c.invisibleTimeout],
  );

  await client.query(
    `INSERT INTO bot_activity_log (bot_id, action, actor, meta)
     VALUES ($1, 'migrated', $2, $3::jsonb)`,
    [bot.id, bot.createdBy || null, JSON.stringify({ source: 'bots.json' })],
  );
}

async function insertSelections(client, userSelections, validBotIds) {
  let count = 0;
  for (const [userId, botId] of Object.entries(userSelections)) {
    if (!validBotIds.has(botId)) {
      log(`  ⚠ skipping selection for ${userId} → unknown bot ${botId}`);
      continue;
    }
    await client.query(
      `INSERT INTO user_selections (user_id, bot_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET bot_id = $2, updated_at = now()`,
      [userId, botId],
    );
    count++;
  }
  return count;
}

async function main() {
  log(`Source file : ${DATA_FILE}`);
  log(`Mode        : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  const { bots, userSelections } = readJson();
  const botList = Object.values(bots);
  const validBotIds = new Set(botList.map((b) => b.id));

  log(`Found ${botList.length} bot(s) and ${Object.keys(userSelections).length} selection(s).`);

  if (DRY_RUN) {
    botList.forEach((b) => log(`  would migrate bot ${b.id} (${b.username}@${b.host}:${b.port})`));
    log('Dry run complete – no changes written.');
    await db.close();
    return;
  }

  await db.assertConnection();

  let migrated = 0;
  await db.withTransaction(async (client) => {
    for (const bot of botList) {
      await insertBot(client, bot);
      migrated++;
      log(`  ✓ migrated bot ${bot.id} (${bot.username})`);
    }
    const sel = await insertSelections(client, userSelections, validBotIds);
    log(`  ✓ migrated ${sel} user selection(s)`);
  });

  log(`Done. Migrated ${migrated} bot(s).`);
  log('Tip: keep a backup of bots.json until you have verified the data in Postgres.');
  await db.close();
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  db.close().finally(() => process.exit(1));
});
