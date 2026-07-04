'use strict';

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

  enqueue(fn, signal = null) {
    if (typeof fn !== 'function') {
      return Promise.reject(new TypeError('Queue.enqueue expects a function'));
    }
    if (this._draining) {
      return Promise.reject(new Error('Queue is draining (bot stopping)'));
    }
    if (this._queue.length >= this.maxSize) {
      this.dropped++;
      this._logger.warn(
        `${this._tag()} Overflow \u2013 dropping task (total dropped: ${this.dropped})`
      );
      return Promise.reject(new Error('Queue full \u2013 task dropped'));
    }
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject, signal });
      if (!this._running) this._run();
    });
  }

  async _run() {
    if (this._running) return;
    this._running = true;
    try {
      while (this._queue.length > 0) {
        if (this._draining) break;
        const { fn, resolve, reject, signal } = this._queue.shift();
        const controller = new AbortController();
        const linkAbort = () => controller.abort(signal.reason);
        if (signal) {
          if (signal.aborted) controller.abort(signal.reason);
          else signal.addEventListener('abort', linkAbort, { once: true });
        }
        let timer = null;
        try {
          const result = await Promise.race([
            fn(controller.signal),
            new Promise((_, rej) => {
              timer = setTimeout(() => {
                const err = new Error(
                  `Queue task timed out after ${this.taskTimeout}ms`
                );
                rej(err);
                controller.abort(err);
              }, this.taskTimeout);
            }),
            new Promise((_, rej) => {
              const onAbort = () =>
                rej(new Error('Queue task aborted before completion'));
              if (controller.signal.aborted) onAbort();
              else
                controller.signal.addEventListener('abort', onAbort, {
                  once: true,
                });
            }),
          ]);
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          if (signal) signal.removeEventListener('abort', linkAbort);
        }
      }
    } finally {
      this._running = false;
    }
  }

  drain() {
    this._draining = true;
    while (this._queue.length > 0) {
      const { reject } = this._queue.shift();
      try {
        reject(new Error('Queue drained'));
      } catch (_) {
        /* ignore if reject handler throws */
      }
    }
    this._queue = [];
  }

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
