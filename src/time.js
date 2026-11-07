'use strict';

// All month/day bucketing happens in the league's time zone (TIMEZONE),
// so a fight at 00:30 on the 1st counts for the new month for everyone.

const formatters = new Map();

function partsFormatter(timeZone) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

function localDate(ms, timeZone) {
  const parts = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM' of the instant `ms` in `timeZone`. */
function monthKey(ms, timeZone) {
  const d = localDate(ms, timeZone);
  return `${d.year}-${pad(d.month)}`;
}

/** 'YYYY-MM-DD' of the instant `ms` in `timeZone`. */
function dayKey(ms, timeZone) {
  const d = localDate(ms, timeZone);
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function isMonthKey(value) {
  return typeof value === 'string' && MONTH_RE.test(value);
}

function shiftMonth(key, delta) {
  const [, y, m] = key.match(MONTH_RE);
  const index = Number(y) * 12 + (Number(m) - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Days remaining in the current month, counting today (1 on the last day). */
function daysLeftInMonth(ms, timeZone) {
  const d = localDate(ms, timeZone);
  const daysInMonth = new Date(Date.UTC(d.year, d.month, 0)).getUTCDate();
  return daysInMonth - d.day + 1;
}

module.exports = { monthKey, dayKey, isMonthKey, shiftMonth, daysLeftInMonth };
