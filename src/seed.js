// Sample menu shown on the first run. Generic on purpose: edit or delete freely.

import { SCHEMA_VERSION } from './schema.js';

const SAMPLE = [
  ['Write a page without editing', 'create', 45, 'mid'],
  ['Doodle for ten minutes', 'create', 15, 'low'],
  ['Start a small project', 'create', 120, 'high'],
  ['One round of a card game', 'play', 45, 'mid'],
  ['Short video game session', 'play', 45, 'low'],
  ['Walk around the block', 'move', 15, 'low'],
  ['Bodyweight workout', 'move', 45, 'high'],
  ['Call a friend for ten minutes', 'connect', 15, 'mid'],
  ['Send a message to someone you miss', 'connect', 15, 'low'],
  ['Cook dinner for two', 'connect', 120, 'mid'],
  ['Read a chapter', 'rest', 45, 'low'],
  ['Make tea and sit by the window', 'rest', 15, 'low'],
];

export function sampleActivities() {
  return SAMPLE.map(([title, category, minutes, energy], i) => ({
    id: `sample-${i + 1}`,
    title,
    category,
    minutes,
    energy,
  }));
}

export function seededState() {
  return { schema: SCHEMA_VERSION, activities: sampleActivities(), entries: [], doing: null };
}
