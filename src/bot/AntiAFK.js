'use strict';

const { goals, Movements } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const { randInt, randFloat, withTimeout } = require('../utils/helpers');
const { botLog } = require('../services/logger');
const { ANTI_AFK } = require('./antiafk/antiAfkConfig');
const { pickTarget } = require('./antiafk/safeSpot');
const { gotoWithStuckDetection } = require('./antiafk/movement');

// Factory passed into the pure safeSpot helpers. bot.blockAt requires a real
// Vec3 instance – the previous code passed plain {x,y,z} objects, so every
// safety check silently failed and the bot could wander into hazards.
const vec3 = (x, y, z) => new Vec3(x, y, z);

/**
 * Keeps a bot from being kicked for inactivity by wandering within a small
 * radius of its anchor and periodically looking around. Spatial reasoning lives
 * in `antiafk/safeSpot`, tuning in `antiafk/antiAfkConfig`, and pathfinding in
 * `antiafk/movement`.
 */
class AntiAFK {
  constructor(bot, botId) {
    this.bot = bot;
    this.botId = botId;
    this.anchor = null; // Vec3 – set when AFK starts
    this._timer = null;
    this._rotTimer = null;
    this._active = false;
    this._moving = false;
  }

  /** Start anti-AFK movement. Call after the bot settles into PLAYING state. */
  start() {
    if (this._active) return;
    this._active = true;
    this.anchor = this.bot.entity.position.clone();

    const movements = new Movements(this.bot);
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = false; // quieter
    movements.maxDropDown = 3; // never fall more than 3 blocks
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
    clearInterval(this._rotTimer); // rotation runs on setInterval
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
    const delay = randInt(ANTI_AFK.MIN_INTERVAL, ANTI_AFK.MAX_INTERVAL);
    this._timer = setTimeout(() => this._doMove(), delay);
  }

  async _doMove() {
    if (!this._active) return;
    this._moving = true;

    for (let attempt = 0; attempt < ANTI_AFK.MAX_RETRIES; attempt++) {
      const target = pickTarget(this.bot, vec3, this.anchor);
      if (!target) {
        botLog(this.botId, 'debug', 'AntiAFK: no safe target, idling this cycle.');
        break;
      }
      try {
        const goal = new goals.GoalNear(target.x, target.y, target.z, 1);
        await withTimeout(
          gotoWithStuckDetection(this.bot, goal, ANTI_AFK.STUCK_TIMEOUT),
          ANTI_AFK.MOVE_TIMEOUT,
          'AntiAFK move',
        );
        break; // success
      } catch (err) {
        botLog(this.botId, 'debug', `AntiAFK attempt ${attempt + 1}/${ANTI_AFK.MAX_RETRIES} failed: ${err.message}`);
        if (attempt === ANTI_AFK.MAX_RETRIES - 1) await this._returnToAnchor();
      }
    }

    this._moving = false;
    if (this._active) this._scheduleMove();
  }

  /** Walk back to the anchor after a failed wander cycle. */
  async _returnToAnchor() {
    if (!this.anchor) return;
    botLog(this.botId, 'debug', 'AntiAFK: returning to anchor.');
    try {
      const goal = new goals.GoalNear(this.anchor.x, this.anchor.y, this.anchor.z, 2);
      await withTimeout(this.bot.pathfinder.goto(goal), ANTI_AFK.MOVE_TIMEOUT, 'Anchor return');
    } catch (_) {
      botLog(this.botId, 'warn', 'AntiAFK: could not return to anchor. Idling.');
    }
  }

  /** Periodically look around to avoid "frozen camera" AFK kicks. */
  _scheduleRotation() {
    if (!this._active) return;
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
    botLog(this.botId, 'debug', 'AntiAFK resumed after combat.');
    this._scheduleMove();
    this._scheduleRotation();
  }

  get isActive() {
    return this._active;
  }
}

module.exports = AntiAFK;
