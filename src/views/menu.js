// Menu: the list of things Vesper can pick from, plus the data tools
// (export, import, reset) at the bottom.
//
// Contents
// - Add / edit dialog
// - Pieces: rows and category groups
// - Data tools: import, reset, the data section
// - Render

import { h, announce, confirmDialog, focusAfterRender, noticeDialog, openModal, dialogTitle, plural, segmented } from '../dom.js';
import * as store from '../state.js';
import * as storage from '../storage.js';
import { dayKey } from '../dates.js';
import { CATEGORIES, ENERGIES, LIMITS, MINUTES, cleanTitle, energyLabel, minutesLabel } from '../schema.js';

const metaOf = (a) => `${minutesLabel(a.minutes)}, ${energyLabel(a.energy).toLowerCase()} energy`;

// Add / edit dialog -----------------------------------------------------------

function activityDialog(activity) {
  const editing = activity !== null;

  return openModal((body, close, dialog) => {
    let minutes = activity?.minutes ?? 45;
    let energy = activity?.energy ?? 'mid';

    const error = h('p', { class: 'field-error', id: 'title-error', role: 'alert' });
    const titleInput = h('input', {
      class: 'input',
      id: 'activity-title',
      type: 'text',
      maxlength: LIMITS.titleMax,
      required: true,
      autocomplete: 'off',
      value: activity?.title ?? '',
      'aria-describedby': 'title-error',
    });
    const categorySelect = h(
      'select',
      { class: 'input', id: 'activity-category' },
      CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === (activity?.category ?? 'create') }, c.label)),
    );

    const formError = h('p', { class: 'field-error', id: 'form-error', role: 'alert' });

    const fail = (message) => {
      error.textContent = message;
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.focus();
    };

    const save = () => {
      formError.textContent = '';
      const title = cleanTitle(titleInput.value);
      if (title === null) return fail(`Give it a name, up to ${LIMITS.titleMax} characters.`);
      const fields = { title, category: categorySelect.value, minutes, energy };
      // Focus is queued only after the store accepts the change, and lands on the
      // saved row, so the person sees where it went and screen readers hear it.
      if (editing) {
        const saved = store.updateActivity(activity.id, fields);
        if (saved === null) {
          formError.textContent = 'This activity was removed in another tab. Cancel, then add it again from the Menu.';
          return;
        }
        focusAfterRender(`[data-id="${saved.id}"]`);
        announce(`Saved ${saved.title}`);
      } else {
        const added = store.addActivity(fields);
        if (added === null) return fail(`Your menu is full (${LIMITS.maxActivities} activities).`);
        focusAfterRender(`[data-id="${added.id}"]`);
        announce(`Added ${added.title}`);
      }
      close(true);
    };

    const remove = async () => {
      const confirmed = await confirmDialog({
        title: 'Delete this activity?',
        message: `"${activity.title}" leaves your menu. Past log entries keep its name.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!confirmed) return;
      focusAfterRender('#add');
      store.deleteActivity(activity.id);
      announce(`Deleted ${activity.title}`);
      close(true);
    };

    body.append(
      dialogTitle(dialog, editing ? 'Edit activity' : 'New activity'),
      h(
        'form',
        {
          class: 'modal-form',
          novalidate: true,
          onsubmit: (event) => {
            event.preventDefault();
            save();
          },
        },
        h('div', { class: 'field' }, h('label', { for: 'activity-title' }, 'What is it?'), titleInput, error),
        h('div', { class: 'field' }, h('label', { for: 'activity-category' }, 'Category'), categorySelect),
        segmented({
          legend: 'Time it takes',
          name: 'activity-minutes',
          options: MINUTES.map((m) => ({ value: m, label: minutesLabel(m) })),
          value: minutes,
          onChange: (value) => {
            minutes = value;
          },
        }),
        segmented({
          legend: 'Energy it needs',
          name: 'activity-energy',
          options: ENERGIES.map((e) => ({ value: e, label: energyLabel(e) })),
          value: energy,
          onChange: (value) => {
            energy = value;
          },
        }),
        formError,
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
        ),
        editing ? h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: remove }, 'Delete activity') : null,
      ),
    );
    window.setTimeout(() => titleInput.focus(), 0);
  });
}

// Pieces ----------------------------------------------------------------------

function row(activity) {
  return h(
    'li',
    {},
    h(
      'button',
      {
        class: 'row',
        type: 'button',
        'data-id': activity.id,
        'aria-label': `Edit ${activity.title}, ${metaOf(activity)}`,
        onclick: () => activityDialog(activity),
      },
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, activity.title), h('span', { class: 'row-meta' }, metaOf(activity))),
    ),
  );
}

function group(category, items) {
  const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title, 'en'));
  return h(
    'section',
    { class: 'group', 'data-cat': category.id },
    h('h2', { class: 'group-title' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), category.label, h('span', { class: 'group-count' }, String(items.length))),
    h('ul', { class: 'list' }, sorted.map(row)),
  );
}

// Data tools ------------------------------------------------------------------

/** Data from a newer version of Vesper is shown but never overwritten, so replacing it is off the table. */
async function blockedByNewerData() {
  if (store.isWritable()) return false;
  await noticeDialog({
    title: 'Read-only for now',
    message: 'This data was saved by a newer version of Vesper, so importing or resetting would overwrite it. Reload the page to get the latest version first.',
  });
  return true;
}

async function onImportFile(event) {
  const input = event.target;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (await blockedByNewerData()) return;

  const result = await storage.readImportFile(file);
  if (!result.ok) {
    await noticeDialog({ title: "Couldn't import that file", message: result.error });
    return;
  }
  const current = store.getState();
  const incoming = result.state;
  const confirmed = await confirmDialog({
    title: 'Replace your data?',
    message: `This replaces ${plural(current.activities.length, 'activity', 'activities')} and ${plural(current.entries.length, 'log entry', 'log entries')} with ${plural(incoming.activities.length, 'activity', 'activities')} and ${plural(incoming.entries.length, 'log entry', 'log entries')} from the file.`,
    confirmLabel: 'Replace',
    danger: true,
  });
  if (!confirmed) return;
  focusAfterRender('#add');
  store.replaceAll(incoming);
  announce('Import complete');
}

async function onReset() {
  if (await blockedByNewerData()) return;
  const confirmed = await confirmDialog({
    title: 'Reset to the sample menu?',
    message: 'Your activities and your log are replaced by the sample menu. Export first if you want a copy.',
    confirmLabel: 'Reset',
    danger: true,
  });
  if (!confirmed) return;
  focusAfterRender('#add');
  store.resetToSample();
  announce('Reset to the sample menu');
}

function dataSection() {
  const fileInput = h('input', { class: 'sr-only', type: 'file', accept: 'application/json,.json', tabindex: '-1', 'aria-hidden': 'true', onchange: onImportFile });
  return h(
    'section',
    { class: 'data' },
    h('h2', { class: 'group-title' }, 'Your data'),
    h('p', { class: 'lede' }, 'Everything stays in this browser. Export a copy now and then, or to move to another device.'),
    h(
      'div',
      { class: 'data-actions' },
      h(
        'button',
        {
          class: 'btn btn-quiet',
          type: 'button',
          onclick: () => {
            storage.exportFile(store.getState(), dayKey());
            announce('Export started');
          },
        },
        'Export',
      ),
      h(
        'button',
        {
          class: 'btn btn-quiet',
          type: 'button',
          // The file picker must open inside the tap itself, so no await before click().
          onclick: () => (store.isWritable() ? fileInput.click() : blockedByNewerData()),
        },
        'Import',
      ),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: onReset }, 'Reset'),
    ),
    fileInput,
  );
}

// Render ----------------------------------------------------------------------

export function render(root) {
  const { activities } = store.getState();
  root.append(
    h('h1', { tabindex: '-1' }, 'Menu'),
    h('p', { class: 'lede' }, 'Things you would actually do on an evening. Vesper picks from this list.'),
    h('button', { class: 'btn btn-primary', type: 'button', id: 'add', onclick: () => activityDialog(null) }, 'Add activity'),
  );

  if (activities.length === 0) {
    root.append(h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Nothing here yet'), h('p', {}, 'Add the first thing you would happily do on a free evening. Small is fine.')));
  }
  for (const category of CATEGORIES) {
    const items = activities.filter((a) => a.category === category.id);
    if (items.length > 0) root.append(group(category, items));
  }
  root.append(dataSection());
}
