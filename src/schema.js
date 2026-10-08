// Data shapes and the single validator used for both localStorage loads and
// imported files. Nothing is copied from parsed JSON as-is: every object is
// rebuilt field by field from a whitelist, so unexpected keys (including
// "__proto__") never reach the app state.
//
// Contents
// - Constants, limits and labels
// - cleanTitle
// - checkActivity, checkEntry and their parse wrappers, parseDoing
// - parseState: the whole-file validator

import { daysBetween, dayKey, isValidKey } from './dates.js';

export const SCHEMA_VERSION = 1;

export const CATEGORIES = [
  { id: 'create', label: 'Create' },
  { id: 'play', label: 'Play' },
  { id: 'move', label: 'Move' },
  { id: 'connect', label: 'Connect' },
  { id: 'rest', label: 'Rest' },
];

export const MINUTES = [15, 45, 120];
export const ENERGIES = ['low', 'mid', 'high'];

export const LIMITS = {
  // Only a guard against huge or garbage files. The largest export the other
  // limits allow is about 2.5 MB pretty-printed, so this stays well above it.
  maxBytes: 4_000_000,
  maxActivities: 500,
  maxEntries: 5000,
  titleMax: 60,
};

const ID_PATTERN = /^[\w-]{1,64}$/;
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const MAX_TS = Date.UTC(9999, 11, 31); // keeps every timestamp a valid Date with a 4 digit year
const MAX_DAY_DRIFT = 2; // days a day key may differ from its timestamp: time zones plus the 04:00 rollover

export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
export const minutesLabel = (m) => (m === 120 ? '2 hours' : `${m} min`);
export const energyLabel = (e) => ({ low: 'Low', mid: 'Medium', high: 'High' })[e] ?? e;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (v) => typeof v === 'string' && ID_PATTERN.test(v);
const validTs = (v) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_TS;

/** Trim, collapse whitespace, and enforce 1..titleMax characters. Returns null when invalid. */
export function cleanTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.replace(/\s+/g, ' ').trim();
  return title.length >= 1 && title.length <= LIMITS.titleMax ? title : null;
}

// Each check returns { value } or { error }, where the error says what to fix.

function checkActivity(raw) {
  if (!isPlainObject(raw)) return { error: 'it is not an object' };
  const title = cleanTitle(raw.title);
  if (title === null) return { error: `the title must be 1 to ${LIMITS.titleMax} characters` };
  if (!validId(raw.id)) return { error: 'its id is missing or has unsupported characters' };
  if (!CATEGORY_IDS.includes(raw.category)) return { error: `the category must be one of ${CATEGORY_IDS.join(', ')}` };
  if (!MINUTES.includes(raw.minutes)) return { error: `the time must be one of ${MINUTES.join(', ')} minutes` };
  if (!ENERGIES.includes(raw.energy)) return { error: `the energy must be one of ${ENERGIES.join(', ')}` };
  return { value: { id: raw.id, title, category: raw.category, minutes: raw.minutes, energy: raw.energy } };
}

function checkEntry(raw) {
  if (!isPlainObject(raw)) return { error: 'it is not an object' };
  const title = cleanTitle(raw.title);
  if (title === null) return { error: `the title must be 1 to ${LIMITS.titleMax} characters` };
  if (!validId(raw.id)) return { error: 'its id is missing or has unsupported characters' };
  if (raw.activityId !== null && !validId(raw.activityId)) return { error: 'its activity id has unsupported characters' };
  if (!CATEGORY_IDS.includes(raw.category)) return { error: `the category must be one of ${CATEGORY_IDS.join(', ')}` };
  if (!isValidKey(raw.dayKey)) return { error: 'the day is not a real date (use YYYY-MM-DD)' };
  if (!validTs(raw.ts)) return { error: 'the timestamp is not a valid time' };
  if (Math.abs(daysBetween(dayKey(new Date(raw.ts)), raw.dayKey)) > MAX_DAY_DRIFT) {
    return { error: 'the day does not match the timestamp' };
  }
  return { value: { id: raw.id, activityId: raw.activityId, title, category: raw.category, dayKey: raw.dayKey, ts: raw.ts } };
}

export const parseActivity = (raw) => checkActivity(raw).value ?? null;
export const parseEntry = (raw) => checkEntry(raw).value ?? null;

/** The "doing it" state keeps its own snapshot so it survives deleting the activity. */
export function parseDoing(raw) {
  if (!isPlainObject(raw)) return null;
  const { id, title, category, minutes, energy } = raw;
  const activity = parseActivity({ id, title, category, minutes, energy });
  if (activity === null || !validTs(raw.startedAt)) return null;
  return { ...activity, startedAt: raw.startedAt };
}

/**
 * Validate a whole saved state. All or nothing: the first problem rejects the
 * file with a message that says what to fix.
 * Returns { ok: true, state } or { ok: false, error, newer? }.
 */
export function parseState(raw, { keepDoing = true } = {}) {
  if (!isPlainObject(raw)) return { ok: false, error: 'This is not a Vesper file.' };
  if (!Number.isSafeInteger(raw.schema) || raw.schema < 1) return { ok: false, error: 'This is not a Vesper file.' };
  if (raw.schema > SCHEMA_VERSION) {
    return { ok: false, newer: true, error: 'This file comes from a newer version of Vesper. Reload the page to get the latest one.' };
  }
  if (!Array.isArray(raw.activities) || !Array.isArray(raw.entries)) {
    return { ok: false, error: 'The file is missing its activities or its log.' };
  }
  if (raw.activities.length > LIMITS.maxActivities) {
    return { ok: false, error: `Too many activities (the limit is ${LIMITS.maxActivities}).` };
  }
  if (raw.entries.length > LIMITS.maxEntries) {
    return { ok: false, error: `Too many log entries (the limit is ${LIMITS.maxEntries}).` };
  }

  const activities = [];
  const activityIds = new Set();
  for (const [i, item] of raw.activities.entries()) {
    const result = checkActivity(item);
    if (result.error) return { ok: false, error: `Activity ${i + 1}: ${result.error}.` };
    if (activityIds.has(result.value.id)) return { ok: false, error: `Activity ${i + 1} repeats an id.` };
    activityIds.add(result.value.id);
    activities.push(result.value);
  }

  const entries = [];
  const entryIds = new Set();
  for (const [i, item] of raw.entries.entries()) {
    const result = checkEntry(item);
    if (result.error) return { ok: false, error: `Log entry ${i + 1}: ${result.error}.` };
    if (entryIds.has(result.value.id)) return { ok: false, error: `Log entry ${i + 1} repeats an id.` };
    entryIds.add(result.value.id);
    entries.push(result.value);
  }

  const doing = keepDoing ? parseDoing(raw.doing) : null;
  return { ok: true, state: { schema: SCHEMA_VERSION, activities, entries, doing } };
}
