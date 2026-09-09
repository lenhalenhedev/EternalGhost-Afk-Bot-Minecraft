'use strict';

/**
 * Size-bounded, retained JSONL log sink (EG-004).
 *
 * The application previously appended to `combined.jsonl` / `error.jsonl`
 * forever. A hostile Minecraft server (or simply a long-lived deployment)
 * could grow those files without limit; the Docker runtime mounts only
 * `/app/logs` as writable, so exhaustion takes the whole container down.
 *
 * This stream keeps `maxFiles` rotated generations of at most `maxBytes`
 * each, so total on-disk usage per file is bounded by
 * `maxBytes * (maxFiles + 1)`. Rotation is synchronous and infrequent; writes
 * stay a plain append.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB per file
const DEFAULT_MAX_FILES = 5; // plus the live file

class RotatingFileStream {
  /**
   * @param {string} filePath   live file, e.g. <logDir>/combined.jsonl
   * @param {object} [options]
   * @param {number} [options.maxBytes]  rotate once the live file exceeds this
   * @param {number} [options.maxFiles]  rotated generations to retain
   * @param {object} [options.fsImpl]    injectable fs for tests
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.maxBytes = Math.max(
      1_024,
      Number.isFinite(options.maxBytes) && options.maxBytes > 0
        ? Math.floor(options.maxBytes)
        : DEFAULT_MAX_BYTES
    );
    this.maxFiles = Math.max(
      1,
      Number.isInteger(options.maxFiles) && options.maxFiles > 0
        ? options.maxFiles
        : DEFAULT_MAX_FILES
    );
    this.fsImpl = options.fsImpl || fs;
    this.rotations = 0;
    this.droppedBytes = 0;
    this.bytesWritten = 0;
    this.writable = true;
    this.lastError = null;
    this._openStream();
    // Honour whatever the previous process already wrote so a restart cannot
    // be used to grow the file past the budget.
    this.bytesWritten = this._currentSize();
  }

  /**
   * Guarantee the live file exists on disk *before* opening a write stream.
   * `createWriteStream` opens lazily, so without this a rotation could rename
   * away a file that the replacement stream has not created yet.
   */
  _openStream() {
    try {
      this.fsImpl.closeSync(this.fsImpl.openSync(this.filePath, 'a'));
    } catch {
      /* the stream open below surfaces any real filesystem problem */
    }
    this._stream = this.fsImpl.createWriteStream(this.filePath, { flags: 'a' });
    // A vanished log volume or a full disk must degrade logging, not crash the
    // process: index.js turns an uncaughtException into a full shutdown.
    this._stream.on('error', (err) => {
      this.lastError = err;
      this.writable = false;
    });
  }

  _currentSize() {
    try {
      return this.fsImpl.statSync(this.filePath).size;
    } catch {
      return 0;
    }
  }

  /** Rotate `file` -> `file.1` -> ... -> `file.maxFiles` (oldest discarded). */
  _rotate() {
    for (let index = this.maxFiles; index >= 1; index -= 1) {
      const from =
        index === 1 ? this.filePath : `${this.filePath}.${index - 1}`;
      const to = `${this.filePath}.${index}`;
      try {
        if (index === this.maxFiles) this.fsImpl.rmSync(to, { force: true });
        this.fsImpl.renameSync(from, to);
      } catch {
        /* a missing generation is normal on the first rotation */
      }
    }
    this.rotations += 1;
    try {
      this._stream.end();
    } catch {
      /* ignore */
    }
    this._openStream();
    this.bytesWritten = 0;
  }

  write(chunk) {
    if (!this.writable) return false;
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    const size = Buffer.byteLength(text);
    // A single oversized record is truncated rather than rotated repeatedly.
    if (size > this.maxBytes) {
      const kept = text.slice(0, this.maxBytes);
      this.droppedBytes += size - Buffer.byteLength(kept);
      this._stream.write(kept);
      this.bytesWritten = this.maxBytes;
      this._rotate();
      return true;
    }
    this._stream.write(text);
    this.bytesWritten += size;
    if (this.bytesWritten >= this.maxBytes) this._rotate();
    return true;
  }

  end() {
    this.writable = false;
    try {
      this._stream.end();
    } catch {
      /* ignore */
    }
  }

  /** Total bytes the retained generations may occupy. */
  get budgetBytes() {
    return this.maxBytes * (this.maxFiles + 1);
  }

  /** Absolute paths of every retained generation, live file first. */
  generations() {
    return [
      this.filePath,
      ...Array.from({ length: this.maxFiles }, (_, index) =>
        path.resolve(`${this.filePath}.${index + 1}`)
      ),
    ];
  }
}

module.exports = {
  RotatingFileStream,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
};
