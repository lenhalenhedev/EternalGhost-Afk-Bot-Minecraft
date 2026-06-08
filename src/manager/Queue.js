'use strict';
const { logger } = require('../services/logger');

/**
 * A sequential async queue for bot operations.
 * Tasks are executed one-at-a-time in FIFO order.
 * - Rejects incoming tasks when the queue is at maxSize (backpressure).
 * - Individual tasks are wrapped in a timeout; overrunning tasks are rejected
 *   but do not block the queue from continuing.
 */
class Queue {
  /**
   * @param {string} botId         – used for logging
   * @param {number} maxSize       – max pending tasks (default 100)
   * @param {number} taskTimeoutMs – per-task timeout (default 10 000 ms)
   */
  constructor(botId, maxSize = 100, taskTimeoutMs = 10_000) {
    this.botId        = botId;
    this.maxSize      = maxSize;
    this.taskTimeout  = taskTimeoutMs;
    this._queue       = [];
    this._running     = false;
    this._draining    = false;
    this.dropped      = 0;  // overflow counter
  }

  /**
   * Enqueue an async task function.
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>} resolves/rejects when the task runs
   */
  enqueue(fn) {
    if (this._draining) {
      return Promise.reject(new Error('Queue is draining (bot stopping)'));
    }
    if (this._queue.length >= this.maxSize) {
      this.dropped++;
      logger.warn(`[Queue:${this.botId.slice(0, 8)}] Overflow – dropping task (total dropped: ${this.dropped})`);
      return Promise.reject(new Error('Queue full – task dropped'));
    }

    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._running) this._run();
    });
  }

  async _run() {
    this._running = true;
    while (this._queue.length > 0) {
      const { fn, resolve, reject } = this._queue.shift();

      try {
        // Race the task against a hard timeout
        const result = await Promise.race([
          fn(),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error(`Queue task timed out after ${this.taskTimeout}ms`)), this.taskTimeout)
          ),
        ]);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }
    this._running = false;
  }

  /**
   * Drain: stop accepting new tasks and reject all pending.
   * Called on bot stop.
   */
  drain() {
    this._draining = true;
    while (this._queue.length > 0) {
      const { reject } = this._queue.shift();
      reject(new Error('Queue drained'));
    }
  }

  /**
   * Reset drain state so the queue can accept tasks again.
   * Must be called before re-starting a stopped bot.
   */
  reset() {
    this._draining = false;
    this._running  = false;
    this._queue    = [];
    logger.debug(`[Queue:${this.botId.slice(0, 8)}] Reset – ready to accept tasks.`);
  }

  get pending() { return this._queue.length; }
  get running() { return this._running; }
  get draining() { return this._draining; }
}

module.exports = Queue;
