// Tonight: choose time and energy, get one suggestion, do it, mark it done.
//
// The suggestion and the filters live in module memory, so switching tabs does
// not re-roll the pick. Only "Mark done" writes to the log.
//
// Contents
// - Module state and ensureSuggestion
// - Pieces: filters, panels, suggestion, doing and closing cards
// - Actions: do it, another, changed my mind, mark done
// - Render

import { h, announce, focusAfterRender, requestRender, segmented } from '../dom.js';
import * as store from '../state.js';
import { pick, stillFits } from '../picker.js';
import { dayKey, formatDay, formatTime, greeting } from '../dates.js';
import { MINUTES, ENERGIES, categoryLabel, energyLabel, minutesLabel } from '../schema.js';

const ui = {
  minutes: 45,
  energy: 'mid',
  shown: new Set(), // ids already suggested with the current filters
  current: null,
  closing: null, // { title, category, dayKey } right after Mark done
  userAction: false, // true when the next render follows a tap, so it may animate and announce
};

function resetPick() {
  ui.shown.clear();
  ui.current = null;
  ui.userAction = true;
}

function ensureSuggestion(state, today) {
  const current = ui.current && state.activities.find((a) => a.id === ui.current.id);
  if (current && stillFits(current, ui.minutes, ui.energy)) {
    ui.current = current;
    return { status: 'ok', fresh: false };
  }
  const result = pick({
    activities: state.activities,
    entries: state.entries,
    minutes: ui.minutes,
    energy: ui.energy,
    today,
    exclude: ui.shown,
  });
  if (result.activity) {
    ui.current = result.activity;
    ui.shown.add(result.activity.id);
    return { status: 'ok', fresh: true };
  }
  ui.current = null;
  return { status: result.reason, fresh: false };
}

// Pieces ----------------------------------------------------------------------

function filters() {
  const keepFocus = (name) => focusAfterRender(`input[name="${name}"]:checked`);
  return h(
    'div',
    { class: 'filters' },
    segmented({
      legend: 'Time you have',
      name: 'minutes',
      options: MINUTES.map((m) => ({ value: m, label: minutesLabel(m) })),
      value: ui.minutes,
      onChange: (value) => {
        ui.minutes = value;
        resetPick();
        keepFocus('minutes');
        requestRender();
      },
    }),
    segmented({
      legend: 'Energy you have',
      name: 'energy',
      options: ENERGIES.map((e) => ({ value: e, label: energyLabel(e) })),
      value: ui.energy,
      onChange: (value) => {
        ui.energy = value;
        resetPick();
        keepFocus('energy');
        requestRender();
      },
    }),
  );
}

const metaLine = (...parts) => h('p', { class: 'pick-meta' }, parts.map((part, i) => h('span', { class: i === 0 ? 'pick-tag' : '' }, part)));

// The title is focusable: when a tap ends on a panel (nothing left to suggest),
// focus moves here and the screen reader reads it.
function panel(title, text, ...actions) {
  return h(
    'section',
    { class: 'panel' },
    h('h2', { class: 'panel-title', id: 'panel-title', tabindex: '-1' }, title),
    h('p', {}, text),
    actions.length ? h('div', { class: 'panel-actions' }, actions) : null,
  );
}

function suggestionCard(activity) {
  const enter = ui.userAction;
  return h(
    'section',
    { class: `pick${enter ? ' pick-enter' : ''}`, 'data-cat': activity.category, 'aria-labelledby': 'pick-title' },
    metaLine(categoryLabel(activity.category), minutesLabel(activity.minutes), `${energyLabel(activity.energy)} energy`),
    h('h2', { class: 'pick-title', id: 'pick-title' }, activity.title),
    h(
      'div',
      { class: 'pick-actions' },
      h('button', { class: 'btn btn-solid', type: 'button', id: 'do-it', onclick: () => doIt(activity) }, 'Do it'),
      h('button', { class: 'btn btn-ghost', type: 'button', id: 'another', onclick: another }, 'Another'),
    ),
  );
}

function doingCard(doing) {
  return h(
    'section',
    { class: 'pick pick-enter', 'data-cat': doing.category, 'aria-labelledby': 'doing-title' },
    metaLine(categoryLabel(doing.category), `Started ${formatTime(doing.startedAt)}`),
    h('h2', { class: 'pick-title', id: 'doing-title', tabindex: '-1' }, doing.title),
    h(
      'div',
      { class: 'pick-actions' },
      h('button', { class: 'btn btn-solid', type: 'button', id: 'mark-done', onclick: markDone }, 'Mark done'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: changedMind }, 'Changed my mind'),
    ),
  );
}

function closingCard(closing) {
  return h(
    'section',
    { class: 'pick pick-enter', 'data-cat': closing.category, 'aria-labelledby': 'closing-title' },
    metaLine('Done', `Logged for ${formatDay(closing.dayKey)}`),
    h('h2', { class: 'pick-title', id: 'closing-title', tabindex: '-1' }, closing.title),
    h(
      'div',
      { class: 'pick-actions' },
      h('button', { class: 'btn btn-solid', type: 'button', id: 'pick-again', onclick: pickAgain }, 'Pick another'),
      h('a', { class: 'btn btn-ghost', href: '#/week' }, 'See the week'),
    ),
  );
}

// Actions ---------------------------------------------------------------------

function doIt(activity) {
  focusAfterRender('#doing-title');
  store.startDoing(activity);
}

// A selector list resolves to whichever element exists after the render, so
// focus lands on the next card or, when nothing is left to suggest, on the panel title.

function another() {
  ui.current = null;
  ui.userAction = true;
  focusAfterRender('#another, #panel-title');
  requestRender();
}

function changedMind() {
  ui.current = null; // it is still in `shown`, so the next pick is a different one
  ui.userAction = true;
  focusAfterRender('#do-it, #panel-title');
  store.cancelDoing();
}

function markDone() {
  const doing = store.getState().doing;
  if (doing === null) return;
  // entryId is filled in once the entry exists. Until then (the synchronous render
  // inside completeDoing) the card shows; afterwards it only shows while the entry does.
  ui.closing = { title: doing.title, category: doing.category, dayKey: dayKey(), entryId: null };
  ui.shown.clear();
  ui.current = null;
  focusAfterRender('#closing-title');
  const entry = store.completeDoing();
  if (entry === null) {
    ui.closing = null;
    return;
  }
  ui.closing.entryId = entry.id;
  announce(`Logged: ${entry.title}`);
}

function pickAgain() {
  ui.closing = null;
  resetPick();
  focusAfterRender('#do-it');
  requestRender();
}

function startOver() {
  resetPick();
  focusAfterRender('#do-it');
  requestRender();
}

// Render ----------------------------------------------------------------------

export function render(root) {
  const state = store.getState();
  const today = dayKey();
  root.append(h('h1', { class: 'greeting', tabindex: '-1' }, greeting()));

  if (state.doing !== null) {
    root.append(doingCard(state.doing));
    ui.userAction = false;
    return;
  }
  if (ui.closing !== null && ui.closing.entryId !== null && !state.entries.some((e) => e.id === ui.closing.entryId)) {
    ui.closing = null; // the entry was removed or the data was replaced: the "Done" card no longer applies
  }
  if (ui.closing !== null) {
    root.append(closingCard(ui.closing));
    ui.userAction = false;
    return;
  }
  if (state.activities.length === 0) {
    root.append(panel('Your menu is empty', 'Add a few things you would actually do on an evening, and Vesper will pick one for you.', h('a', { class: 'btn btn-primary', href: '#/menu' }, 'Open the menu')));
    return;
  }

  root.append(filters());
  const { status, fresh } = ensureSuggestion(state, today);

  if (status === 'ok') {
    root.append(suggestionCard(ui.current));
    if (fresh && ui.userAction) {
      announce(`${ui.current.title}. ${categoryLabel(ui.current.category)}, ${minutesLabel(ui.current.minutes)}.`);
    }
  } else if (status === 'exhausted') {
    root.append(panel("That's everything that fits", 'You have seen every option for these settings.', h('button', { class: 'btn btn-primary', type: 'button', id: 'start-over', onclick: startOver }, 'Start over')));
  } else {
    root.append(
      panel(
        'Nothing fits yet',
        `Nothing on your menu fits ${minutesLabel(ui.minutes)} and ${energyLabel(ui.energy).toLowerCase()} energy yet. Try more time or energy, or add something small to the menu.`,
        h('a', { class: 'btn btn-primary', href: '#/menu' }, 'Open the menu'),
      ),
    );
  }
  ui.userAction = false;
}
