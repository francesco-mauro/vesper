// Chooses one activity. Pure: it takes data and a random function, returns a result.
//
// An activity is a candidate when it fits inside the time and energy you have.
// Each candidate gets a weight, and one is drawn in proportion to its weight:
//
//   weight = 1 / (1 + doneRecently[category])    categories you skipped lately win
//          / countInCategory                      a crowded category does not dominate
//          * 0.2 if it was the last thing done    avoid back to back repeats
//          * 2   if its time matches exactly      so "2 hours" is not all 15 minute things
//          * 2   if its energy matches exactly

import { recentCounts } from './stats.js';

export const ENERGY_RANK = { low: 0, mid: 1, high: 2 };

const fits = (activity, minutes, energy) =>
  activity.minutes <= minutes && ENERGY_RANK[activity.energy] <= ENERGY_RANK[energy];

// Entries dated after today are ignored, so a file with far-future timestamps
// cannot make one activity count as "just done" forever.
function lastDoneId(entries, today) {
  let latest = null;
  for (const entry of entries) {
    if (entry.dayKey > today) continue;
    if (latest === null || entry.ts > latest.ts) latest = entry;
  }
  return latest ? latest.activityId : null;
}

/**
 * @returns {{ activity: object|null, reason?: 'no-fit'|'exhausted' }}
 *   no-fit: nothing on the menu fits these filters
 *   exhausted: everything that fits has already been shown (see `exclude`)
 */
export function pick({ activities, entries, minutes, energy, today, exclude = new Set(), rng = Math.random }) {
  const candidates = activities.filter((a) => fits(a, minutes, energy));
  if (candidates.length === 0) return { activity: null, reason: 'no-fit' };

  const pool = candidates.filter((a) => !exclude.has(a.id));
  if (pool.length === 0) return { activity: null, reason: 'exhausted' };

  const recent = recentCounts(entries, today);
  const perCategory = {};
  for (const a of pool) perCategory[a.category] = (perCategory[a.category] ?? 0) + 1;
  const last = lastDoneId(entries, today);

  const weights = pool.map((a) => {
    let w = 1 / (1 + recent[a.category]) / perCategory[a.category];
    if (a.id === last) w *= 0.2;
    if (a.minutes === minutes) w *= 2;
    if (a.energy === energy) w *= 2;
    return w;
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r < 0) return { activity: pool[i] };
  }
  return { activity: pool[pool.length - 1] }; // float drift, or an rng that returned 1
}

/** True when the activity is still allowed by the current filters. */
export const stillFits = (activity, minutes, energy) => fits(activity, minutes, energy);
