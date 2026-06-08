'use strict';
const { goals, Movements } = require('mineflayer-pathfinder');
const { randInt, randFloat, sleep, withTimeout } = require('../utils/helpers');
const { botLog } = require('../services/logger');

const MIN_RADIUS     = 5;
const MAX_RADIUS     = 10;
const MIN_INTERVAL   = 5_000;
const MAX_INTERVAL   = 15_000;
const MAX_RETRIES    = 3;
const MOVE_TIMEOUT   = 20_000;  // abort pathfinding after 20s
const STUCK_TIMEOUT  = 12_000;  // declare "stuck" if position doesn't change for 12s
const ROTATION_INTERVAL = 3_000; // random look-around every 3s

/** Danger block names (fragment match). */
const DANGER_NAMES = ['lava', 'fire', 'magma_block', 'cactus', 'sweet_berry_bush', 'wither_rose'];
const isDanger = name => DANGER_NAMES.some(d => name.includes(d));

class AntiAFK {
  constructor(bot, botId) {
    this.bot       = bot;
    this.botId     = botId;
    this.anchor    = null; // Vec3 – set when AFK starts
    this._timer    = null;
    this._rotTimer = null;
    this._active   = false;
    this._moving   = false;
  }

  /** Start anti-AFK movement. Call after bot is settled in PLAYING state. */
  start() {
    if (this._active) return;
    this._active = true;
    this.anchor  = this.bot.entity.position.clone();

    // Configure pathfinder movements – safety first
    const movements = new Movements(this.bot);
    movements.canDig           = false;
    movements.allow1by1towers  = false;
    movements.allowParkour     = false;
    movements.allowSprinting   = false;   // quieter
    movements.maxDropDown      = 3;       // won't fall more than 3 blocks
    movements.blockDangerFaces = true;
    this.bot.pathfinder.setMovements(movements);

    botLog(this.botId, 'info', `AntiAFK started. Anchor: ${JSON.stringify(this.anchor)}`);
    this._scheduleMove();
    this._scheduleRotation();
  }

  /** Stop all anti-AFK activity. */
  stop() {
    this._active = false;
    clearTimeout(this._timer);
    clearTimeout(this._rotTimer);
    this._timer    = null;
    this._rotTimer = null;
    try { this.bot.pathfinder.setGoal(null); } catch (_) { /* ignore */ }
    this._moving = false;
    botLog(this.botId, 'info', 'AntiAFK stopped.');
  }

  _scheduleMove() {
    if (!this._active) return;
    const delay = randInt(MIN_INTERVAL, MAX_INTERVAL);
    this._timer = setTimeout(() => this._doMove(), delay);
  }

  async _doMove() {
    if (!this._active) return;
    this._moving = true;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const target = this._pickTarget();
      if (!target) {
        botLog(this.botId, 'debug', 'AntiAFK: no safe target, idling this cycle.');
        break;
      }
      try {
        const goal = new goals.GoalNear(target.x, target.y, target.z, 1);
        await withTimeout(
          this._gotoWithStuckDetection(goal, target),
          MOVE_TIMEOUT,
          'AntiAFK move'
        );
        break; // success
      } catch (err) {
        botLog(this.botId, 'debug', `AntiAFK attempt ${attempt + 1}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt === MAX_RETRIES - 1) {
          // All retries exhausted – go back to anchor
          await this._returnToAnchor();
        }
      }
    }

    this._moving = false;
    if (this._active) this._scheduleMove();
  }

  /** Move to goal with stuck detection. */
  async _gotoWithStuckDetection(goal, target) {
    const bot = this.bot;
    let lastPos = bot.entity.position.clone();
    let stuckMs = 0;
    const CHECK_INTERVAL = 1000;
    const STUCK_LIMIT    = STUCK_TIMEOUT;

    const stuckChecker = setInterval(() => {
      const cur = bot.entity.position;
      const dist = cur.distanceTo(lastPos);
      if (dist < 0.1) {
        stuckMs += CHECK_INTERVAL;
        if (stuckMs >= STUCK_LIMIT) {
          clearInterval(stuckChecker);
          bot.pathfinder.setGoal(null);
        }
      } else {
        stuckMs = 0;
        lastPos = cur.clone();
      }
    }, CHECK_INTERVAL);

    try {
      await bot.pathfinder.goto(goal);
    } finally {
      clearInterval(stuckChecker);
    }
  }

  /** Return bot to the anchor point. */
  async _returnToAnchor() {
    if (!this.anchor) return;
    botLog(this.botId, 'debug', 'AntiAFK: returning to anchor.');
    try {
      const goal = new goals.GoalNear(this.anchor.x, this.anchor.y, this.anchor.z, 2);
      await withTimeout(this.bot.pathfinder.goto(goal), MOVE_TIMEOUT, 'Anchor return');
    } catch (_) {
      botLog(this.botId, 'warn', 'AntiAFK: could not return to anchor. Idling.');
      // Idle: just rotate in place
    }
  }

  /** Pick a random safe target within radius of anchor. */
  _pickTarget() {
    const { anchor, bot } = this;
    if (!anchor) return null;

    for (let i = 0; i < 20; i++) {
      const angle  = randFloat(0, Math.PI * 2);
      const radius = randFloat(MIN_RADIUS, MAX_RADIUS);
      const x = Math.round(anchor.x + Math.cos(angle) * radius);
      const z = Math.round(anchor.z + Math.sin(angle) * radius);

      // Find correct Y by scanning downward from anchor.y+3 to anchor.y-5
      for (let y = anchor.y + 3; y >= anchor.y - 5; y--) {
        if (this._isSafe(x, y, z)) return { x, y, z };
      }
    }
    return null;
  }

  /** Check if position is safe to stand on. */
  _isSafe(x, y, z) {
    const bot = this.bot;
    const below = bot.blockAt(bot.registry ? { x, y: y - 1, z } : { x, y: y - 1, z });
    const feet  = bot.blockAt({ x, y, z });
    const head  = bot.blockAt({ x, y: y + 1, z });

    if (!below || !feet || !head) return false;

    // Must have solid ground
    if (below.boundingBox !== 'block') return false;
    // Feet and head must be clear
    if (feet.boundingBox  !== 'empty') return false;
    if (head.boundingBox  !== 'empty') return false;

    // No danger blocks in the column
    if (isDanger(below.name) || isDanger(feet.name) || isDanger(head.name)) return false;

    // Check no void-ish gap below (already guaranteed by below.boundingBox === 'block')
    return true;
  }

  /** Periodically look around to avoid "frozen camera" AFK kicks. */
  _scheduleRotation() {
    if (!this._active) return;
    this._rotTimer = setInterval(() => {
      if (!this._active || this._moving) return;
      try {
        const yaw   = randFloat(-Math.PI, Math.PI);
        const pitch = randFloat(-0.3, 0.3);
        this.bot.look(yaw, pitch, false);
      } catch (_) { /* ignore */ }
    }, ROTATION_INTERVAL);
  }

  /** Called when combat starts – stop moving immediately. */
  pauseForCombat() {
    clearTimeout(this._timer);
    clearTimeout(this._rotTimer);
    try { this.bot.pathfinder.setGoal(null); } catch (_) { /* ignore */ }
    this._moving = false;
    botLog(this.botId, 'debug', 'AntiAFK paused for combat.');
  }

  /** Resume after combat. */
  resumeAfterCombat() {
    if (!this._active) return;
    botLog(this.botId, 'debug', 'AntiAFK resumed after combat.');
    this._scheduleMove();
    this._scheduleRotation();
  }

  get isActive() { return this._active; }
}

module.exports = AntiAFK;
