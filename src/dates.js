// Day and week helpers.
// A "day key" is a local calendar date as YYYY-MM-DD. The day rolls over at
// DAY_START_HOUR, so something finished at 00:30 still belongs to the evening
// that started before midnight. Day arithmetic goes through Date.UTC so that
// daylight saving changes can never shift a date.

export const DAY_START_HOUR = 4;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');
const formatKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Day key for a moment in time, in local time, honouring DAY_START_HOUR. */
export function dayKey(date = new Date()) {
  const d = new Date(date.getTime());
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return formatKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Parse a day key. Returns { y, m, d } or null when it is not a real date. */
export function parseKey(key) {
  if (typeof key !== 'string') return null;
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  const real = check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
  return real ? { y, m, d } : null;
}

export const isValidKey = (key) => parseKey(key) !== null;

const toUtc = (key) => {
  const { y, m, d } = parseKey(key);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from key a to key b (negative when b is earlier). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function addDays(key, n) {
  const { y, m, d } = parseKey(key);
  const next = new Date(Date.UTC(y, m - 1, d + n));
  return formatKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Monday of the week that contains the key. */
export function weekStart(key) {
  const sinceMonday = (new Date(toUtc(key)).getUTCDay() + 6) % 7;
  return addDays(key, -sinceMonday);
}

/** The seven day keys, Monday to Sunday, of the week that contains the key. */
export function weekKeys(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const weekdayName = (key) => WEEKDAYS[new Date(toUtc(key)).getUTCDay()];

/** "Thursday 8 Oct" */
export function formatDay(key) {
  const { m, d } = parseKey(key);
  return `${weekdayName(key)} ${d} ${MONTHS[m - 1]}`;
}

/** "Thu 8 Oct" */
export function formatShort(key) {
  const { m, d } = parseKey(key);
  return `${weekdayName(key).slice(0, 3)} ${d} ${MONTHS[m - 1]}`;
}

/** "Mon 5 Oct to Sun 11 Oct" */
export function formatWeekRange(key) {
  const keys = weekKeys(key);
  return `${formatShort(keys[0])} to ${formatShort(keys[6])}`;
}

/** "Thursday evening", used as the greeting on the Tonight screen. */
export function greeting(date = new Date()) {
  const hour = date.getHours();
  let part = 'night';
  if (hour >= DAY_START_HOUR && hour < 12) part = 'morning';
  else if (hour >= 12 && hour < 17) part = 'afternoon';
  else if (hour >= 17 && hour < 22) part = 'evening';
  return `${weekdayName(dayKey(date))} ${part}`;
}

/** "21:40" in local time. */
export function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
