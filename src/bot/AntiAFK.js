'use strict';
const { Vec3 } = require('vec3');
const { Movements, goals } = require('mineflayer-pathfinder');
const { randInt, randFloat, withTimeout } = require('../utils/helpers');
const { botLog } = require('../services/logger');
const { ANTI_AFK } = require('./antiafk/antiAfkConfig');
const { pickTarget } = require('./antiafk/safeSpot');
const { gotoWithStuckDetection } = require('./antiafk/movement');

const vec3 = (x, y, z) => new Vec3(x, y, z);

/**
 * Keeps a bot from being kicked for inactivity.
 *
 * MEMORY LEAK FIXES:
 * - pauseForCombat() now properly nullifies timer references after clearing
 * - resumeAfterCombat() checks if timers already exist before creating new ones
 *   to prevent duplicate interval/timeout accumulation
 * - _scheduleRotation() clears existing rotation timer before creating a new one
 * - _scheduleMove() clears existing move timer before creating a new one
 * - stop() is fully idempotent
 */
class AntiAFK {
  constructor(bot, botId) {
    this.bot = bot;
    this.botId = botId;
    this.anchor = null;
    this._timer = null;
    this._rotTimer = null;
    this._active = false;
    this._moving = false;
  }

  start() {
    if (this._active) return;
    this._active = true;
    this.anchor = this.bot.entity.position.clone();
    const movements = new Movements(this.bot);
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = false;
    movements.maxDropDown = 3;
    movements.blockDangerFaces = true;
    this.bot.pathfinder.setMovements(movements);
    botLog(
      this.botId,
      'info',
      `AntiAFK started. Anchor: ${JSON.stringify(this.anchor)}`
    );
    this._scheduleMove();
    this._scheduleRotation();
  }

  stop() {
    this._active = false;
    clearTimeout(this._timer);
    clearInterval(this._rotTimer);
    this._timer = null;
    this._rotTimer = null;
    try {
      this.bot.pathfinder.setGoal(null);
    } catch (_) {
      /* ignore */
    }
    this._moving = false;
    botLog(this.botId, 'info', 'AntiAFK stopped.');
  }

  _scheduleMove() {
    if (!this._active) return;
    // FIX: Clear any existing timer before scheduling a new one to prevent
    // duplicate timers from accumulating (e.g., if called multiple times).
    clearTimeout(this._timer);
    const delay = randInt(ANTI_AFK.MIN_INTERVAL, ANTI_AFK.MAX_INTERVAL);
    this._timer = setTimeout(() => this._doMove(), delay);
  }

  async _doMove() {
    if (!this._active) return;
    this._moving = true;
    for (let attempt = 0; attempt < ANTI_AFK.MAX_RETRIES; attempt++) {
      const target = pickTarget(this.bot, vec3, this.anchor);
      if (!target) {
        botLog(
          this.botId,
          'debug',
          'AntiAFK: no safe target, idling this cycle.'
        );
        break;
      }
      try {
        const goal = new goals.GoalNear(target.x, target.y, target.z, 1);
        await withTimeout(
          gotoWithStuckDetection(this.bot, goal, ANTI_AFK.STUCK_TIMEOUT),
          ANTI_AFK.MOVE_TIMEOUT,
          'AntiAFK move'
        );
        break;
      } catch (err) {
        botLog(
          this.botId,
          'debug',
          `AntiAFK attempt ${attempt + 1}/${ANTI_AFK.MAX_RETRIES} failed: ${err.message}`
        );
        if (attempt === ANTI_AFK.MAX_RETRIES - 1) await this._returnToAnchor();
      }
    }
    this._moving = false;
    if (this._active) this._scheduleMove();
  }

  async _returnToAnchor() {
    if (!this.anchor) return;
    botLog(this.botId, 'debug', 'AntiAFK: returning to anchor.');
    try {
      const goal = new goals.GoalNear(
        this.anchor.x,
        this.anchor.y,
        this.anchor.z,
        2
      );
      await withTimeout(
        this.bot.pathfinder.goto(goal),
        ANTI_AFK.MOVE_TIMEOUT,
        'Anchor return'
      );
    } catch (_) {
      botLog(
        this.botId,
        'warn',
        'AntiAFK: could not return to anchor. Idling.'
      );
    }
  }

  _scheduleRotation() {
    if (!this._active) return;
    // FIX: Clear existing rotation timer before creating a new one to prevent
    // interval accumulation when resumeAfterCombat is called multiple times.
    clearInterval(this._rotTimer);
    this._rotTimer = setInterval(() => {
      if (!this._active || this._moving) return;
      try {
        const yaw = randFloat(-Math.PI, Math.PI);
        const pitch = randFloat(-0.3, 0.3);
        this.bot.look(yaw, pitch, false);
      } catch (_) {
        /* ignore */
      }
    }, ANTI_AFK.ROTATION_INTERVAL);
  }

  /** Called when combat starts – stop moving immediately. */
  pauseForCombat() {
    // FIX: Clear and nullify both timers to prevent dangling references
    clearTimeout(this._timer);
    clearInterval(this._rotTimer);
    this._timer = null;
    this._rotTimer = null;
    try {
      this.bot.pathfinder.setGoal(null);
    } catch (_) {
      /* ignore */
    }
    this._moving = false;
    botLog(this.botId, 'debug', 'AntiAFK paused for combat.');
  }

  /** Resume after combat ends. */
  resumeAfterCombat() {
    if (!this._active) return;
    // FIX: Only schedule if not already scheduled (prevents duplicate timers
    // if resumeAfterCombat is called multiple times without a pause in between).
    if (!this._timer) {
      this._scheduleMove();
    }
    if (!this._rotTimer) {
      this._scheduleRotation();
    }
    botLog(this.botId, 'debug', 'AntiAFK resumed after combat.');
  }

  get isActive() {
    return this._active;
  }
}

module.exports = AntiAFK;
