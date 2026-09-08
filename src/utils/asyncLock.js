'use strict';

/**
 * Keyed asynchronous mutex (EG-005).
 *
 * Bot quota checks were a check-then-await-then-register sequence: every
 * concurrent `createBot` read the same in-memory count before any of them
 * awaited persistence, so N requests from one slot below the limit all passed
 * and all registered. Rate limiting is a burst control, not mutual exclusion.
 *
 * `runExclusive` serialises the critical section per key without holding a
 * thread, and prunes the key as soon as the queue drains so long-running
 * processes cannot accumulate map entries.
 */
class AsyncLock {
  constructor() {
    /** @type {Map<string, Promise<void>>} */
    this._tails = new Map();
  }

  /** Number of keys currently holding a queue (for tests/telemetry). */
  get size() {
    return this._tails.size;
  }

  /**
   * Run `fn` once every previously queued task for `key` has settled.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>|T} fn
   * @returns {Promise<T>}
   */
  runExclusive(key, fn) {
    if (typeof fn !== 'function') {
      return Promise.reject(
        new TypeError('AsyncLock.runExclusive expects a function')
      );
    }
    const previous = this._tails.get(key) ?? Promise.resolve();
    const run = previous.then(() => fn());
    // The queued tail must survive a rejection, otherwise one failing task
    // would release the lock for everyone still waiting.
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this._tails.set(key, tail);
    void tail.then(() => {
      if (this._tails.get(key) === tail) this._tails.delete(key);
    });
    return run;
  }
}

module.exports = { AsyncLock };
