// Everything that touches localStorage, files and downloads.
// Storage can be missing, blocked or full, so every access is guarded and the
// callers get a plain status back instead of an exception.
//
// Contents
// - load, save, onExternalChange: localStorage and cross-tab updates
// - Unreadable data: kept under two keys, downloadable from the banner
// - exportFile: download as JSON
// - readImportFile: read and validate an uploaded file

import { LIMITS, parseState } from './schema.js';

export const KEY = 'vesper.state';
const CORRUPT_KEY = 'vesper.state.corrupt';
const CORRUPT_PREV_KEY = 'vesper.state.corrupt.prev';
const PROBE_KEY = 'vesper.probe';

let store; // undefined: not probed yet, null: unavailable
let unreadableText = null; // the last unreadable data, kept in memory too

function getStore() {
  if (store !== undefined) return store;
  try {
    const candidate = window.localStorage;
    candidate.setItem(PROBE_KEY, '1');
    candidate.removeItem(PROBE_KEY);
    store = candidate;
  } catch {
    store = null;
  }
  return store;
}

/**
 * Keep a copy of data that could not be read. Two slots, newest first, so a
 * second problem never destroys the only copy. Returns whether a copy is safe.
 */
function quarantine(candidate, text) {
  unreadableText = text;
  try {
    const current = candidate.getItem(CORRUPT_KEY);
    if (current === text) return true;
    if (current !== null) candidate.setItem(CORRUPT_PREV_KEY, current);
    candidate.setItem(CORRUPT_KEY, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the saved state.
 * status: 'ok' | 'fresh' (nothing saved yet) | 'unavailable' | 'newer'
 *       | 'corrupt' (unreadable, a copy is kept) | 'corrupt-unkept' (unreadable, no copy could be saved)
 */
export function load() {
  const candidate = getStore();
  if (!candidate) return { state: null, status: 'unavailable' };

  let text;
  try {
    text = candidate.getItem(KEY);
  } catch {
    return { state: null, status: 'unavailable' };
  }
  if (text === null) return { state: null, status: 'fresh' };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: null, status: quarantine(candidate, text) ? 'corrupt' : 'corrupt-unkept' };
  }
  const result = parseState(parsed);
  if (result.ok) return { state: result.state, status: 'ok' };
  if (result.newer) return { state: null, status: 'newer' };
  return { state: null, status: quarantine(candidate, text) ? 'corrupt' : 'corrupt-unkept' };
}

/** Returns false when the write failed (blocked or full). */
export function save(state) {
  const candidate = getStore();
  if (!candidate) return false;
  try {
    candidate.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Calls back with a freshly loaded state when another tab changes the data. */
export function onExternalChange(callback) {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) callback(load());
  });
}

// Downloads --------------------------------------------------------------

function download(text, type, filename) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the data as a JSON file. The "doing it" state is not exported. */
export function exportFile(state, today) {
  const { schema, activities, entries } = state;
  download(JSON.stringify({ schema, activities, entries }, null, 2), 'application/json', `vesper-${today}.json`);
}

/** Download the data Vesper could not read, so nothing is lost for good. */
export function exportUnreadable(today) {
  let text = unreadableText;
  try {
    text = getStore()?.getItem(CORRUPT_KEY) ?? text;
  } catch {
    // Fall back to the in-memory copy.
  }
  if (text === null) return false;
  download(text, 'text/plain', `vesper-unreadable-${today}.txt`);
  return true;
}

/** Read and validate a user-supplied file. Same shape as parseState. */
export async function readImportFile(file) {
  if (file.size > LIMITS.maxBytes) return { ok: false, error: 'That file is too large to be a Vesper export.' };
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  return parseState(parsed, { keepDoing: false });
}
