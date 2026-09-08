'use strict';

/**
 * Backpressure-aware Server-Sent Events writer (EG-004).
 *
 * `res.write()` returns `false` once the socket buffer is full, which is the
 * normal condition for a stalled or slow dashboard client. The events router
 * previously ignored that return value, so a hostile Minecraft server flooding
 * one bot's log stream could grow the kernel/Node write queue for every
 * connected client without bound.
 *
 * This writer keeps at most `maxBuffered` frames per connection. When the
 * budget is exhausted the least valuable buffered frames — log events, which
 * are re-fetchable from the per-bot ring buffer — are dropped and counted, so
 * state/health/auth frames always win.
 */

const DEFAULT_MAX_BUFFERED = 200;

class SseWriter {
  /**
   * @param {import('node:http').ServerResponse} res
   * @param {{maxBuffered?: number}} [options]
   */
  constructor(res, options = {}) {
    this.res = res;
    this.maxBuffered = Math.max(
      1,
      Number.isInteger(options.maxBuffered) && options.maxBuffered > 0
        ? options.maxBuffered
        : DEFAULT_MAX_BUFFERED
    );
    /** @type {Array<{kind: string, frame: string}>} */
    this._buffered = [];
    this._closed = false;
    this._paused = false;
    this.dropped = 0;
    this.written = 0;
    this._onDrain = () => {
      this._paused = false;
      this._flush();
    };
    this.res.on?.('drain', this._onDrain);
  }

  get buffered() {
    return this._buffered.length;
  }

  get closed() {
    return this._closed;
  }

  /**
   * Queue one SSE frame. `kind` is `'log'` for droppable log traffic and
   * anything else for frames that must not be dropped while budget remains.
   * The buffer never exceeds `maxBuffered`, so this always accepts.
   * @returns {boolean} true when the frame was accepted
   */
  write(frame, kind = 'event') {
    if (this._closed) return false;
    if (this._buffered.length >= this.maxBuffered) {
      // Evict the oldest droppable log frame first; only when none remains do
      // we evict the oldest frame of any kind, keeping the hard bound.
      const droppable = this._buffered.findIndex(
        (entry) => entry.kind === 'log'
      );
      this._buffered.splice(droppable >= 0 ? droppable : 0, 1);
      this.dropped += 1;
    }
    this._buffered.push({ kind, frame });
    this._flush();
    return true;
  }

  _flush() {
    if (this._paused) return;
    while (this._buffered.length > 0 && !this._closed) {
      const entry = this._buffered[0];
      let accepted;
      try {
        accepted = this.res.write(entry.frame) !== false;
      } catch {
        this._closed = true;
        this._buffered.length = 0;
        return;
      }
      // The frame is queued by the socket either way; a `false` return only
      // means the high-water mark was crossed, so stop writing until 'drain'.
      this._buffered.shift();
      this.written += 1;
      if (!accepted) {
        this._paused = true;
        return;
      }
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._buffered.length = 0;
    this.res.off?.('drain', this._onDrain);
  }
}

module.exports = { SseWriter, DEFAULT_MAX_BUFFERED };
