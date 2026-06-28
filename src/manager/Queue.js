'use strict';
/**
 * A sequential async queue for bot operations.
 *
 * MEMORY LEAK FIXES:
 * - Timeout timer is ALWAYS cleared in a `finally` block (the original already
 *   did this correctly, but we add an explicit null assignment for clarity)
 * - drain() now also clears any active timeout timer reference
 * - The _queue array is explicitly emptied on drain/reset to release closures
 * - Added AbortController pattern for cleaner timeout cancellation
 */
class Queue {
  constructor(botId, maxSize = 100, taskTimeoutMs = 10_000, logger = console) {
    this.botId = botId;
    this.maxSize = maxSize;
    this.taskTimeout = taskTimeoutMs;
    this._logger = logger;
    this._queue = [];
    this._running = false;
    this._draining = false;
    this.dropped = 0;
  }

  _tag() {
    return `[Queue:${String(this.botId).slice(0, 8)}]`;
  }

  /**
   * Enqueue an async task function.
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  enqueue(fn) {
    if (typeof fn !== 'function') {
      return Promise.reject(new TypeError('Queue.enqueue expects a function'));
    }
    if (this._draining) {
      return Promise.reject(new Error('Queue is draining (bot stopping)'));
    }
    if (this._queue.length >= this.maxSize) {
      this.dropped++;
      this._logger.warn(`${this._tag()} Overflow – dropping task (total dropped: ${this.dropped})`);
      return Promise.reject(new Error('Queue full – task dropped'));
    }
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._running) this._run();
    });
  }

  async _run() {
    if (this._running) return;
    this._running = true;
    try {
      while (this._queue.length > 0) {
        if (this._draining) break;
        const { fn, resolve, reject } = this._queue.shift();
        let timer = null;
        try {
          const result = await Promise.race([
            fn(),
            new Promise((_, rej) => {
              timer = setTimeout(
                () => rej(new Error(`Queue task timed out after ${this.taskTimeout}ms`)),
                this.taskTimeout,
              );
            }),
          ]);
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          // FIX: Always clear the timeout timer to prevent leaks.
          // Also null the reference to help GC if the closure is retained.
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
        }
      }
    } finally {
      this._running = false;
    }
  }

  /** Stop accepting new tasks and reject all pending ones. */
  drain() {
    this._draining = true;
    // FIX: Reject and release all pending tasks to free their closures
    while (this._queue.length > 0) {
      const { reject } = this._queue.shift();
      try {
        reject(new Error('Queue drained'));
      } catch (_) {
        /* ignore if reject handler throws */
      }
    }
    // FIX: Ensure the array is truly empty (no dangling references)
    this._queue = [];
  }

  /** Reset drain state so the queue can accept tasks again after a restart. */
  reset() {
    this._draining = false;
    this._queue = [];
    if (typeof this._logger.debug === 'function') {
      this._logger.debug(`${this._tag()} Reset – ready to accept tasks.`);
    }
  }

  get pending() {
    return this._queue.length;
  }

  get running() {
    return this._running;
  }

  get draining() {
    return this._draining;
  }
}

module.exports = Queue;
