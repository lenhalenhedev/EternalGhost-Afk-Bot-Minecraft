'use strict';
const AntiAFK = require('./AntiAFK');
const Combat = require('./Combat');
const Inventory = require('./Inventory');
const AutoEat = require('./AutoEat');
const FoodFinder = require('../services/foodFinder');

class Subsystems {
  constructor(id) {
    this.id = id;
    this.antiAFK = null;
    this.combat = null;
    this.inventory = null;
    this.autoEat = null;
    this.foodFinder = null;
  }

  startPlaying(bot, emit, cfg = {}) {
    if (this.autoEat) {
      this.autoEat.stop();
      this.autoEat = null;
    }
    if (this.foodFinder) {
      this.foodFinder.stop();
      this.foodFinder = null;
    }
    this.inventory = null;

    this.inventory = new Inventory(bot, this.id, emit);
    this.foodFinder = new FoodFinder(bot, this.id);
    this.foodFinder.start();
    this.autoEat = new AutoEat(
      bot,
      this.id,
      (event, ...args) => {
        emit(event, ...args);
        if (event === 'noFood') this.foodFinder?.onNoFood();
      },
      cfg.autoEat
    );
    this.autoEat.start();
  }

  startAFK(bot, onCombatEvent, cfg = {}) {
    if (this.antiAFK) {
      this.antiAFK.stop();
      this.antiAFK = null;
    }
    if (this.combat) {
      this.combat.stop();
      this.combat = null;
    }
    this.antiAFK = new AntiAFK(bot, this.id, cfg.antiAfk);
    this.antiAFK.start();
    this.combat = new Combat(bot, this.id, onCombatEvent, cfg.combat);
    this.combat.startScanning();
  }

  enterCombat() {
    if (this.antiAFK) this.antiAFK.pauseForCombat();
    if (this.autoEat) this.autoEat.setCombat(true);
    if (this.foodFinder) this.foodFinder.stop();
  }

  exitCombat() {
    if (this.antiAFK) this.antiAFK.resumeAfterCombat();
    if (this.autoEat) this.autoEat.setCombat(false);
    if (this.foodFinder) this.foodFinder.start();
  }

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
    if (this.foodFinder) {
      this.foodFinder.stop();
      this.foodFinder = null;
    }
    this.inventory = null;
  }
}

module.exports = Subsystems;
