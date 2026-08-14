'use strict';

const { goals } = require('mineflayer-pathfinder');
const AutoEat = require('../bot/AutoEat');
const { botLog } = require('./logger');

const SEARCH_RADIUS = 24;
const PICKUP_RADIUS = 1;
const HUNT_APPROACH_RADIUS = 2;
const MELEE_RANGE = 3;
const ATTACK_INTERVAL_TICKS = 10;
const HUNT_TIMEOUT_MS = 30_000;
const MAX_HUNT_APPROACHES = 3;
const NAVIGATION_TIMEOUT_MS = 20_000;
const PASSIVE_FOOD_MOBS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit']);

function distanceBetween(first, second) {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  if (typeof first.distanceTo === 'function') return first.distanceTo(second);
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function isItemAdded(oldItem, newItem) {
  if (!AutoEat.isFood(newItem)) return false;
  if (!AutoEat.isFood(oldItem)) return true;
  if (oldItem.type !== newItem.type || oldItem.metadata !== newItem.metadata)
    return true;
  return newItem.count > oldItem.count;
}

function waitForNavigation(navigation, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Food navigation timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([navigation, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

class FoodFinder {
  constructor(bot, botId) {
    this.bot = bot;
    this.botId = botId;
    this._active = false;
    this._searching = false;
    this._searchPending = false;
    this._searchId = 0;
    this._onItemDrop = this._handleItemDrop.bind(this);
    this._onInventoryUpdate = this._handleInventoryUpdate.bind(this);
  }

  start() {
    if (this._active) return;
    this._active = true;
    this.bot.on?.('itemDrop', this._onItemDrop);
    this.bot.inventory?.on?.('updateSlot', this._onInventoryUpdate);
    this._startSearch();
  }

  stop() {
    if (!this._active) return;
    this._active = false;
    this.bot.removeListener?.('itemDrop', this._onItemDrop);
    this.bot.inventory?.removeListener?.('updateSlot', this._onInventoryUpdate);
    this._cancelSearch();
  }

  onNoFood() {
    this._searchPending = true;
    this._startSearch();
  }

  _startSearch() {
    if (!this._active || !this._searchPending || this._searching) return;
    this._findFoodSource().catch((err) => {
      botLog(this.botId, 'warn', `FoodFinder failed: ${err.message}`);
    });
  }

  _handleItemDrop(entity) {
    if (this._searchPending && AutoEat.isFood(this._droppedItem(entity)))
      this._startSearch();
  }

  _handleInventoryUpdate(_slot, oldItem, newItem) {
    if (!isItemAdded(oldItem, newItem)) return;
    this._searchPending = false;
    this._cancelSearch();
  }

  async _findFoodSource() {
    const pathfinder = this.bot.pathfinder;
    if (!pathfinder?.goto || !this.bot.entity?.position) {
      botLog(
        this.botId,
        'warn',
        'FoodFinder unavailable: pathfinder is not ready.'
      );
      return;
    }

    const searchId = ++this._searchId;
    this._searching = true;
    try {
      const droppedFood = this._findNearestDroppedFood();
      if (droppedFood) {
        await this._navigateToDroppedFood(droppedFood, searchId);
        return;
      }

      const mob = this._findNearestFoodMob();
      if (!mob) return;

      await this._huntFoodMob(mob, searchId);
      if (!this._isCurrentSearch(searchId)) return;

      const droppedFoodAfterHunt = this._findNearestDroppedFood();
      if (droppedFoodAfterHunt)
        await this._navigateToDroppedFood(droppedFoodAfterHunt, searchId);
    } finally {
      if (this._isCurrentSearch(searchId)) this._searching = false;
    }
  }

  async _navigateToDroppedFood(target, searchId) {
    if (
      !this._isCurrentSearch(searchId) ||
      !this._hasLineOfSight(target.position)
    )
      return;

    const { x, y, z } = target.position;
    await waitForNavigation(
      this.bot.pathfinder.goto(new goals.GoalNear(x, y, z, PICKUP_RADIUS)),
      NAVIGATION_TIMEOUT_MS
    );
  }

  async _huntFoodMob(target, searchId) {
    const huntDeadline = Date.now() + HUNT_TIMEOUT_MS;
    let approachCount = 0;

    while (this._isCurrentSearch(searchId) && Date.now() < huntDeadline) {
      const currentTarget = this._currentFoodMob(target.id);
      if (
        !currentTarget ||
        !this._isWithinSearchRadius(currentTarget) ||
        !this._hasLineOfSight(currentTarget.position)
      )
        return;

      if (!this._isWithinMeleeRange(currentTarget)) {
        if (approachCount >= MAX_HUNT_APPROACHES) return;
        const { x, y, z } = currentTarget.position;
        await waitForNavigation(
          this.bot.pathfinder.goto(
            new goals.GoalNear(x, y, z, HUNT_APPROACH_RADIUS)
          ),
          NAVIGATION_TIMEOUT_MS
        );
        approachCount += 1;
        continue;
      }

      if (typeof this.bot.attack !== 'function') return;
      try {
        this.bot.attack(currentTarget);
      } catch (err) {
        botLog(this.botId, 'warn', `FoodFinder attack failed: ${err.message}`);
        return;
      }

      if (typeof this.bot.waitForTicks !== 'function') return;
      await this.bot.waitForTicks(ATTACK_INTERVAL_TICKS);
    }
  }

  _findNearestDroppedFood() {
    const origin = this.bot.entity?.position;
    if (!origin) return null;

    let nearest = null;
    let nearestDistance = SEARCH_RADIUS;
    for (const entity of Object.values(this.bot.entities ?? {})) {
      const item = this._droppedItem(entity);
      if (!AutoEat.isFood(item) || !entity?.position) continue;
      const distance = distanceBetween(origin, entity.position);
      if (!Number.isFinite(distance) || distance > nearestDistance) continue;
      if (!this._hasLineOfSight(entity.position)) continue;
      nearest = entity;
      nearestDistance = distance;
    }
    return nearest;
  }

  _findNearestFoodMob() {
    const origin = this.bot.entity?.position;
    if (!origin) return null;

    let nearest = null;
    let nearestDistance = SEARCH_RADIUS;
    for (const entity of Object.values(this.bot.entities ?? {})) {
      if (!this._isFoodMob(entity)) continue;
      const distance = distanceBetween(origin, entity.position);
      if (!Number.isFinite(distance) || distance > nearestDistance) continue;
      if (!this._hasLineOfSight(entity.position)) continue;
      nearest = entity;
      nearestDistance = distance;
    }
    return nearest;
  }

  _currentFoodMob(entityId) {
    const entity = this.bot.entities?.[entityId];
    return this._isFoodMob(entity) ? entity : null;
  }

  _isFoodMob(entity) {
    return Boolean(
      entity &&
      entity.id !== this.bot.entity?.id &&
      entity.type === 'mob' &&
      entity.position &&
      entity.metadata?.[0]?.value !== 1 &&
      PASSIVE_FOOD_MOBS.has(this._entityName(entity))
    );
  }

  _entityName(entity) {
    const rawName = entity?.name || entity?.displayName || '';
    return String(rawName)
      .toLowerCase()
      .replace(/^minecraft:/, '')
      .replace(/ /g, '_');
  }

  _isWithinSearchRadius(entity) {
    const origin = this.bot.entity?.position;
    return distanceBetween(origin, entity?.position) <= SEARCH_RADIUS;
  }

  _isWithinMeleeRange(entity) {
    const origin = this.bot.entity?.position;
    return distanceBetween(origin, entity?.position) <= MELEE_RANGE;
  }

  _hasLineOfSight(targetPosition) {
    const origin = this._eyePosition();
    if (
      !origin ||
      !targetPosition ||
      typeof this.bot.world?.raycast !== 'function'
    )
      return false;

    const distance = distanceBetween(origin, targetPosition);
    if (!Number.isFinite(distance) || distance <= 0) return false;

    const direction = {
      x: (targetPosition.x - origin.x) / distance,
      y: (targetPosition.y - origin.y) / distance,
      z: (targetPosition.z - origin.z) / distance,
    };

    try {
      const obstruction = this.bot.world.raycast(
        origin,
        direction,
        distance,
        (block, iterator) => this._isSolidIntersection(block, iterator)
      );
      return !obstruction;
    } catch (err) {
      botLog(this.botId, 'warn', `FoodFinder LOS check failed: ${err.message}`);
      return false;
    }
  }

  _eyePosition() {
    const entity = this.bot.entity;
    if (!entity?.position || !Number.isFinite(entity.height)) return null;
    if (typeof entity.position.offset === 'function')
      return entity.position.offset(0, entity.height, 0);
    return {
      x: entity.position.x,
      y: entity.position.y + entity.height,
      z: entity.position.z,
    };
  }

  _isSolidIntersection(block, iterator) {
    if (
      block?.boundingBox !== 'block' ||
      !Array.isArray(block.shapes) ||
      block.shapes.length === 0
    )
      return false;
    if (typeof iterator?.intersect !== 'function') return true;
    return Boolean(iterator.intersect(block.shapes, block.position));
  }

  _droppedItem(entity) {
    try {
      return entity?.getDroppedItem?.() ?? null;
    } catch {
      return null;
    }
  }

  _cancelSearch() {
    if (!this._searching) return;
    this._searching = false;
    this._searchId += 1;
    try {
      this.bot.pathfinder?.setGoal(null);
    } catch (err) {
      botLog(this.botId, 'warn', `FoodFinder stop path failed: ${err.message}`);
    }
  }

  _isCurrentSearch(searchId) {
    return this._active && this._searching && this._searchId === searchId;
  }

  get isSearching() {
    return this._searching;
  }
}

module.exports = FoodFinder;
