const pad = (n) => String(n).padStart(2, '0');
const formatters = new Map();

function zonedParts(date, timeZone) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return parts;
}

/** The current local date (YYYY-MM-DD) and minutes since midnight in `timeZone`. */
export function zonedNow(timeZone, date = new Date()) {
  const p = zonedParts(date, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, minutes: p.hour * 60 + p.minute };
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function offsetMs(utcMs, timeZone) {
  const p = zonedParts(new Date(utcMs), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** Unix seconds for a wall-clock time on a date in `timeZone` (for Discord <t:...> timestamps). */
export function zonedTimeToUnix(dateStr, hour, minute, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  return Math.floor((guess - offsetMs(first, timeZone)) / 1000);
}
