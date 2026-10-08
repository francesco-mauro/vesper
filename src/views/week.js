// Week: how the current Monday to Sunday week is going, by category and by day.

import { h, announce, confirmDialog, focusAfterRender } from '../dom.js';
import * as store from '../state.js';
import { dayKey, formatDay, formatTime, formatWeekRange } from '../dates.js';
import { CATEGORIES, categoryLabel } from '../schema.js';
import { groupByDay, insight, weekCounts } from '../stats.js';

const MIN_SCALE = 3; // a bar is never "full" after a single entry

function categoryBars(counts) {
  const scale = Math.max(MIN_SCALE, ...Object.values(counts));
  return h(
    'ul',
    { class: 'bars' },
    CATEGORIES.map((category) => {
      const count = counts[category.id];
      const fill = h('span', { class: 'bar-fill' });
      fill.style.setProperty('--w', String((count / scale) * 100));
      return h(
        'li',
        { class: 'bar-row', 'data-cat': category.id },
        h('span', { class: 'bar-label' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), category.label),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, fill),
        h('span', { class: 'bar-count' }, String(count)),
      );
    }),
  );
}

/** The id of the entry next to this one (below it, or above if it is last), or null. */
function neighbourId(id) {
  const rows = [...document.querySelectorAll('.entry[data-entry-id]')];
  const index = rows.findIndex((row) => row.getAttribute('data-entry-id') === id);
  const next = rows[index + 1] ?? rows[index - 1];
  return next ? next.getAttribute('data-entry-id') : null;
}

async function removeEntry(entry) {
  const confirmed = await confirmDialog({
    title: 'Remove this entry?',
    message: `"${entry.title}" on ${formatDay(entry.dayKey)} will no longer count.`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!confirmed) return;
  // Keep the person's place: focus moves to the neighbouring entry's button, or
  // to the heading when this was the last one.
  const next = neighbourId(entry.id);
  focusAfterRender(next ? `[data-entry-id="${next}"] button` : 'h1');
  store.removeEntry(entry.id);
  announce(`Removed ${entry.title}`);
}

function entryRow(entry) {
  return h(
    'li',
    { class: 'entry', 'data-cat': entry.category, 'data-entry-id': entry.id },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, entry.title), h('span', { class: 'row-meta' }, `${categoryLabel(entry.category)} at ${formatTime(entry.ts)}`)),
    h('button', { class: 'btn btn-text btn-small', type: 'button', 'aria-label': `Remove ${entry.title}`, onclick: () => removeEntry(entry) }, 'Remove'),
  );
}

export function render(root) {
  const { activities, entries } = store.getState();
  const today = dayKey();
  const { counts, total } = weekCounts(entries, today);

  root.append(
    h('h1', { tabindex: '-1' }, 'This week'),
    h('p', { class: 'lede' }, formatWeekRange(today)),
    h('p', { class: 'insight' }, insight(entries, activities, today)),
    h('h2', { class: 'group-title' }, 'By category'),
    categoryBars(counts),
    h('h2', { class: 'group-title' }, 'Log'),
  );

  if (total === 0) {
    root.append(h('section', { class: 'panel' }, h('p', {}, 'Nothing logged this week yet.'), h('a', { class: 'btn btn-primary', href: '#/tonight' }, 'Pick something')));
    return;
  }
  for (const day of groupByDay(entries, today)) {
    root.append(h('section', { class: 'day' }, h('h3', { class: 'day-title' }, formatDay(day.dayKey)), h('ul', { class: 'list' }, day.entries.map(entryRow))));
  }
}
