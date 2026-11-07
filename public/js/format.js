// Month and day keys ('2026-11', '2026-11-07') come from the server already
// in the league's time zone, so they're formatted as plain calendar dates.

const fmt = (options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options });
const monthLong = fmt({ month: 'long', year: 'numeric' });
const monthOnly = fmt({ month: 'long' });
const monthShortFmt = fmt({ month: 'short', year: 'numeric' });
const dayLong = fmt({ weekday: 'long', day: 'numeric', month: 'short' });
const dayShort = fmt({ day: 'numeric', month: 'short' });

const monthDate = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
};
const dayDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const monthLabel = (key) => monthLong.format(monthDate(key)); // November 2026
export const monthName = (key) => monthOnly.format(monthDate(key)); // November
export const monthShort = (key) => monthShortFmt.format(monthDate(key)); // Nov 2026
export const dayLabel = (key) => dayLong.format(dayDate(key)); // Saturday 7 Nov
export const dayShortLabel = (key) => dayShort.format(dayDate(key)); // 7 Nov

const timeFormats = new Map();
/** 21:43 in the league time zone. */
export function timeLabel(ms, timeZone) {
  let f = timeFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormats.set(timeZone, f);
  }
  return f.format(new Date(ms));
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}
