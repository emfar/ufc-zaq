'use strict';

/**
 * Counts failures per key in a fixed window. In memory on purpose: the app
 * runs as a single process and a restart simply clears the counters.
 */
class FailureLimiter {
  constructor({ max, windowMs, now = () => Date.now() }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  /** Milliseconds until `key` may try again, or 0 if it isn't blocked. */
  retryAfter(key) {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    const now = this.now();
    if (entry.resetAt <= now) {
      this.entries.delete(key);
      return 0;
    }
    return entry.count >= this.max ? entry.resetAt - now : 0;
  }

  fail(key) {
    const now = this.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
    if (this.entries.size > 10_000) this.prune();
  }

  reset(key) {
    this.entries.delete(key);
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }
}

module.exports = { FailureLimiter };
