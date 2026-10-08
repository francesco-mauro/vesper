// Small DOM helpers. Everything is built with createElement and textContent:
// no innerHTML anywhere, so user-written titles can never become markup.
//
// Contents
// - h, plural, segmented: element builder and the pill-shaped radio group
// - Re-rendering and focus: requestRender, focusAfterRender, applyFocus, announce
// - Dialogs: openModal, confirmDialog, noticeDialog

/** h('button', { class: 'btn', onclick: fn }, 'Label') */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2), value);
    else if (name === 'class') el.className = value;
    else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(value));
  }
  el.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A group of pill-shaped radio buttons. Radios give arrow-key movement and a
 * proper group label for free; the pills are just styling on the <span>.
 */
export function segmented({ legend, name, options, value, onChange }) {
  return h(
    'fieldset',
    { class: 'seg' },
    h('legend', {}, legend),
    h(
      'div',
      { class: 'seg-row' },
      options.map((option) =>
        h(
          'label',
          { class: 'seg-opt' },
          h('input', {
            type: 'radio',
            name,
            value: String(option.value),
            checked: option.value === value,
            onchange: () => onChange(option.value),
          }),
          h('span', {}, option.label),
        ),
      ),
    ),
  );
}

// Re-rendering and focus -------------------------------------------------

const RENDER_EVENT = 'vesper:render';

/** Ask the app shell to render the current view again. */
export const requestRender = () => document.dispatchEvent(new Event(RENDER_EVENT));
export const onRenderRequest = (callback) => document.addEventListener(RENDER_EVENT, callback);

let pendingFocus = null;

/** After the next render, move focus to the element that matches this selector. */
export function focusAfterRender(selector) {
  pendingFocus = selector;
}

/** Applies the pending focus. Waits while a dialog is open, because the page is inert then. */
export function applyFocus(root) {
  if (pendingFocus === null || document.querySelector('dialog[open]')) return false;
  const target = root.querySelector(pendingFocus);
  pendingFocus = null;
  if (!target) return false;
  target.focus();
  return true;
}

/** Say something to screen readers without moving focus. */
export function announce(message) {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 60);
}

// Dialogs -----------------------------------------------------------------

/**
 * Opens a native modal <dialog>. `build(body, close, dialog)` fills it; calling
 * close(value) resolves the promise with that value. Escape and a click on the
 * backdrop resolve it with undefined.
 */
export function openModal(build) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const body = h('div', { class: 'modal-body' });
    const dialog = h('dialog', { class: 'modal' }, body);
    let result;

    const close = (value) => {
      result = value;
      dialog.close();
    };

    // Close on a backdrop click only when the press started there too: dragging
    // a text selection out of the form and letting go outside must not close it.
    let pressedOnBackdrop = false;
    dialog.addEventListener('pointerdown', (event) => {
      pressedOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', (event) => {
      const closeIt = event.target === dialog && pressedOnBackdrop;
      pressedOnBackdrop = false;
      if (closeIt) close(undefined);
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else {
        const view = document.getElementById('view');
        if (view && !applyFocus(view)) view.querySelector('h1')?.focus();
      }
      resolve(result);
    });

    build(body, close, dialog);
    document.body.append(dialog);
    dialog.showModal();
  });
}

let dialogCounter = 0;

function titled(dialog, title) {
  dialogCounter += 1;
  const id = `dialog-title-${dialogCounter}`;
  dialog.setAttribute('aria-labelledby', id);
  return h('h2', { class: 'modal-title', id }, title);
}

/** The message paragraph, wired as the dialog's description so it is read when the dialog opens. */
function described(dialog, message) {
  const id = `dialog-text-${dialogCounter}`;
  dialog.setAttribute('aria-describedby', id);
  return h('p', { class: 'modal-text', id }, message);
}

/** Resolves true when the person confirms. The safe button has focus first. */
export async function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const answer = await openModal((body, close, dialog) => {
    if (danger) dialog.setAttribute('role', 'alertdialog');
    body.append(
      titled(dialog, title),
      described(dialog, message),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn btn-quiet', type: 'button', autofocus: true, onclick: () => close(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => close(true) }, confirmLabel),
      ),
    );
  });
  return answer === true;
}

/** A message with a single OK button. */
export function noticeDialog({ title, message }) {
  return openModal((body, close, dialog) => {
    body.append(
      titled(dialog, title),
      described(dialog, message),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn btn-primary', type: 'button', autofocus: true, onclick: () => close(true) }, 'OK')),
    );
  });
}

export { titled as dialogTitle };
