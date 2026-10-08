// The single source of truth. State objects are never mutated: every action
// builds a new one, saves it, and tells the subscribers.
//
// Contents
// - Plumbing: commit, init, syncFromStorage, getState, getStatus, isWritable, subscribe
// - Ids
// - Activities: add, update, delete
// - Doing it, then done: start, cancel, complete, prune
// - Whole-data operations: replaceAll, resetToSample

import { LIMITS, parseActivity } from './schema.js';
import { dayKey } from './dates.js';
import { seededState } from './seed.js';
import * as storage from './storage.js';

const DOING_TTL_MS = 12 * 60 * 60 * 1000;

let state = seededState();
let status = 'fresh'; // 'ok' | 'fresh' | 'unavailable' | 'save-failed' | 'corrupt' | 'newer'
let writable = true;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

const isStale = (doing, now) => doing !== null && now - doing.startedAt > DOING_TTL_MS;
const withoutStaleDoing = (s, now = Date.now()) => (isStale(s.doing, now) ? { ...s, doing: null } : s);

function commit(next) {
  state = next;
  if (writable) {
    if (storage.save(next)) {
      if (status === 'fresh' || status === 'save-failed') status = 'ok';
    } else if (status !== 'unavailable') {
      status = 'save-failed';
    }
  }
  notify();
}

/** Take over data that changed in storage behind our back, if it differs from what we hold. */
function adopt(external) {
  if (!external) return false;
  const next = withoutStaleDoing(external);
  if (JSON.stringify(next) === JSON.stringify(state)) return false;
  state = next;
  notify();
  return true;
}

export function init() {
  const loaded = storage.load();
  status = loaded.status;
  writable = loaded.status !== 'newer';
  state = withoutStaleDoing(loaded.state ?? seededState());
  storage.onExternalChange(({ state: external }) => adopt(external));
}

/** Call when the page comes back to the foreground: another tab or the clock may have moved on. */
export function syncFromStorage() {
  pruneDoing();
  adopt(storage.load().state);
}

export const getState = () => state;
export const getStatus = () => status;

/** False when the saved data comes from a newer version of Vesper: it is shown but never overwritten. */
export const isWritable = () => writable;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 16 hex characters. getRandomValues works on plain http, randomUUID does not. */
function makeId() {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function uniqueId(items) {
  const taken = new Set(items.map((item) => item.id));
  let id = makeId();
  while (taken.has(id)) id = makeId();
  return id;
}

// Activities

export function addActivity(fields) {
  if (state.activities.length >= LIMITS.maxActivities) return null;
  const activity = parseActivity({ ...fields, id: uniqueId(state.activities) });
  if (activity === null) return null;
  commit({ ...state, activities: [...state.activities, activity] });
  return activity;
}

export function updateActivity(id, fields) {
  const next = parseActivity({ ...fields, id });
  if (next === null || !state.activities.some((a) => a.id === id)) return null;
  commit({ ...state, activities: state.activities.map((a) => (a.id === id ? next : a)) });
  return next;
}

export function deleteActivity(id) {
  commit({ ...state, activities: state.activities.filter((a) => a.id !== id) });
}

// Doing it, then done

export function startDoing(activity) {
  const { id, title, category, minutes, energy } = activity;
  commit({ ...state, doing: { id, title, category, minutes, energy, startedAt: Date.now() } });
}

export function cancelDoing() {
  if (state.doing !== null) commit({ ...state, doing: null });
}

/** Writes one log entry and clears "doing". A second call finds nothing to do, so a double tap logs once. */
export function completeDoing(now = new Date()) {
  const { doing } = state;
  if (doing === null) return null;
  const entry = {
    id: uniqueId(state.entries),
    activityId: state.activities.some((a) => a.id === doing.id) ? doing.id : null,
    title: doing.title,
    category: doing.category,
    dayKey: dayKey(now),
    ts: now.getTime(),
  };
  // The log keeps the most recent maxEntries; older ones drop off (they only ever show in an export).
  const entries = [...state.entries, entry].sort((a, b) => a.ts - b.ts).slice(-LIMITS.maxEntries);
  commit({ ...state, entries, doing: null });
  return entry;
}

/** Drops a "doing" that has been sitting around for hours. Returns true if it changed anything. */
export function pruneDoing(now = Date.now()) {
  if (!isStale(state.doing, now)) return false;
  commit({ ...state, doing: null });
  return true;
}

export function removeEntry(id) {
  commit({ ...state, entries: state.entries.filter((e) => e.id !== id) });
}

// Whole-data operations

export function replaceAll(next) {
  commit({ ...next, doing: null });
}

export function resetToSample() {
  commit(seededState());
}
