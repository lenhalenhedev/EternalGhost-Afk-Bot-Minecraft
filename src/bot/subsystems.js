'use strict';

const AntiAFK = require('./AntiAFK');
const Combat = require('./Combat');
const Inventory = require('./Inventory');
const AutoEat = require('./AutoEat');

/**
 * Owns the lifecycle of a bot's gameplay subsystems (anti-AFK, combat,
 * inventory, auto-eat). Extracted from BotInstance so the orchestrator only
 * deals with the state machine while this class deals with wiring/teardown
 * (single responsibility).
 */
class Subsystems {
  constructor(id) {
    this.id = id;
    this.antiAFK = null;
    this.combat = null;
    this.inventory = null;
    this.autoEat = null;
  }

  /** Create inventory + auto-eat when the bot starts playing. */
  startPlaying(bot, emit) {
    this.inventory = new Inventory(bot, this.id, emit);
    this.autoEat = new AutoEat(bot, this.id, emit);
    this.autoEat.start();
  }

  /** Start anti-AFK wandering and combat scanning once in AFK mode. */
  startAFK(bot, onCombatEvent) {
    this.antiAFK = new AntiAFK(bot, this.id);
    this.antiAFK.start();
    this.combat = new Combat(bot, this.id, onCombatEvent);
    this.combat.startScanning();
  }

  /** Pause non-combat subsystems while fighting. */
  enterCombat() {
    if (this.antiAFK) this.antiAFK.pauseForCombat();
    if (this.autoEat) this.autoEat.setCombat(true);
  }

  /** Resume normal AFK behaviour after combat ends. */
  exitCombat() {
    if (this.antiAFK) this.antiAFK.resumeAfterCombat();
    if (this.autoEat) this.autoEat.setCombat(false);
  }

  /** Stop and release every subsystem (idempotent). */
  stopAll() {
    if (this.antiAFK) {
      this.antiAFK.stop();
      this.antiAFK = null;
    }
    if (this.combat) {
      this.combat.stop();
      this.combat = null;
    }
    if (this.autoEat) {
      this.autoEat.stop();
      this.autoEat = null;
    }
    this.inventory = null;
  }
}

module.exports = Subsystems;
