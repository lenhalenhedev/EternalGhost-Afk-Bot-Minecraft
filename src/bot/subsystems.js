'use strict';
const AntiAFK = require('./AntiAFK');
const Combat = require('./Combat');
const Inventory = require('./Inventory');
const AutoEat = require('./AutoEat');

/**
 * Owns the lifecycle of a bot's gameplay subsystems.
 *
 * MEMORY LEAK FIXES:
 * - Both `startPlaying` and `startAFK` are IDEMPOTENT: they tear down any
 *   existing subsystem before creating a replacement.
 * - This is critical — a respawn (or a death during the settle window) can call
 *   these again while old instances are still live, and overwriting the reference
 *   without stopping it first would orphan its setInterval timers forever,
 *   compounding on every death until the process pins a CPU core and bloats RAM.
 * - stopAll() explicitly nullifies all references after stopping to aid GC.
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
    // FIX: Idempotent — stop a previous auto-eat checker before replacing it.
    // Without this, the old AutoEat's setInterval keeps running after the
    // reference is overwritten, leaking the interval timer.
    if (this.autoEat) {
      this.autoEat.stop();
      this.autoEat = null;
    }
    // FIX: Also stop inventory if it existed (though Inventory has no timers,
    // clearing the reference helps GC release the old bot reference).
    this.inventory = null;

    this.inventory = new Inventory(bot, this.id, emit);
    this.autoEat = new AutoEat(bot, this.id, emit);
    this.autoEat.start();
  }

  /** Start anti-AFK wandering and combat scanning once in AFK mode. */
  startAFK(bot, onCombatEvent) {
    // FIX: Idempotent — stop any previous instances so their interval timers
    // are cleared before we drop the references and create fresh ones.
    if (this.antiAFK) {
      this.antiAFK.stop();
      this.antiAFK = null;
    }
    if (this.combat) {
      this.combat.stop();
      this.combat = null;
    }
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
