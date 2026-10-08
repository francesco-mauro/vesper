// Numbers and sentences derived from the log. Pure functions: no DOM, no storage.

import { CATEGORIES, categoryLabel } from './schema.js';
import { addDays, daysBetween, weekKeys } from './dates.js';

const emptyCounts = () => Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));

/** Completions per category over the rolling window that ends today. Used to weight the pick. */
export function recentCounts(entries, today, days = 7) {
  const oldest = addDays(today, -(days - 1));
  const counts = emptyCounts();
  for (const entry of entries) {
    if (entry.dayKey >= oldest && entry.dayKey <= today) counts[entry.category] += 1;
  }
  return counts;
}

/** Completions per category for the Monday to Sunday week that contains today. */
export function weekCounts(entries, today) {
  const keys = new Set(weekKeys(today));
  const counts = emptyCounts();
  let total = 0;
  for (const entry of entries) {
    if (keys.has(entry.dayKey)) {
      counts[entry.category] += 1;
      total += 1;
    }
  }
  return { counts, total };
}

/** Whole days since the last completion in a category, or null if there is none. */
export function daysSince(entries, category, today) {
  let latest = null;
  for (const entry of entries) {
    if (entry.category === category && (latest === null || entry.dayKey > latest)) latest = entry.dayKey;
  }
  return latest === null ? null : Math.max(0, daysBetween(latest, today));
}

/** Entries of the current week grouped by day, newest day first, newest entry first. */
export function groupByDay(entries, today) {
  const keys = new Set(weekKeys(today));
  const groups = new Map();
  for (const entry of entries) {
    if (!keys.has(entry.dayKey)) continue;
    if (!groups.has(entry.dayKey)) groups.set(entry.dayKey, []);
    groups.get(entry.dayKey).push(entry);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dayKey, list]) => ({ dayKey, entries: list.sort((a, b) => b.ts - a.ts) }));
}

const GAP_DAYS = 4;

/**
 * One calm sentence about balance. Only categories that have something on the
 * menu are considered, because the others cannot be acted on.
 */
export function insight(entries, activities, today) {
  const onMenu = CATEGORIES.filter((c) => activities.some((a) => a.category === c.id));
  if (onMenu.length === 0) return 'Add a few activities to your menu to get started.';
  if (entries.length === 0) return 'Nothing logged yet. Your first pick is one tap away.';

  let worst = null;
  for (const category of onMenu) {
    const gap = daysSince(entries, category.id, today);
    const score = gap === null ? Infinity : gap;
    if (worst === null || score > worst.score) worst = { category, gap, score };
  }
  if (worst.gap === null) return `${categoryLabel(worst.category.id)} has not shown up yet.`;
  if (worst.gap >= GAP_DAYS) {
    return `${categoryLabel(worst.category.id)} has not shown up in ${worst.gap} days.`;
  }
  return 'Every category has had a turn in the last few days.';
}
