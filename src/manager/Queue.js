'use strict';

/**
 * A sequential async queue for bot operations. Tasks run one-at-a-time in FIFO
 * order with per-task timeouts and backpressure when full.
 *
 * The logger is injected (dependency inversion) so the queue has no hard
 * dependency on the winston service and can be unit tested with a stub.
 *
 * Leak safety: every task races a timeout whose timer is ALWAYS cleared in a
 * `finally` (so a fast task never leaks its timeout), and `drain()` rejects and
 * releases every pending task. The drive loop also bails as soon as draining
 * begins so no further timers are armed during teardown.
 */
class Queue {
  /**
   * @param {string} botId used for log tagging
   * @param {number} maxSize max pending tasks
   * @param {number} taskTimeoutMs per-task timeout
   * @param warn:Function,debug?:Function [logger] log sink (defaults to console)
   */
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
      this._logger.warn(`${this._tag()} Overflow \u2013 dropping task (total dropped: ${this.dropped})`);
      return Promise.reject(new Error('Queue full \u2013 task dropped'));
    }
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._running) this._run();
    });
  }

  async _run() {
    if (this._running) return; // re-entrancy guard prevents concurrent loops
    this._running = true;
    try {
      while (this._queue.length > 0) {
        if (this._draining) break; // teardown began – drain() handles the rest
        const { fn, resolve, reject } = this._queue.shift();
        let timer;
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
          clearTimeout(timer); // avoid leaking the timeout when the task wins
        }
      }
    } finally {
      this._running = false;
    }
  }

  /** Stop accepting new tasks and reject all pending ones. */
  drain() {
    this._draining = true;
    while (this._queue.length > 0) {
      const { reject } = this._queue.shift();
      reject(new Error('Queue drained'));
    }
  }

  /** Reset drain state so the queue can accept tasks again after a restart. */
  reset() {
    this._draining = false;
    this._queue = [];
    if (typeof this._logger.debug === 'function') {
      this._logger.debug(`${this._tag()} Reset \u2013 ready to accept tasks.`);
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
