// App shell: hash routing between the three views, the storage banner,
// resuming after the page was in the background, and (off localhost) the
// service worker.
//
// Contents
// - Routes and banner messages
// - routeName, renderBanner, renderApp
// - Start-up, listeners and resume
// - Service worker registration

import * as store from './state.js';
import * as storage from './storage.js';
import { applyFocus, h, onRenderRequest } from './dom.js';
import { dayKey } from './dates.js';
import * as tonight from './views/tonight.js';
import * as menu from './views/menu.js';
import * as week from './views/week.js';

const ROUTES = {
  tonight: { view: tonight, title: 'Tonight' },
  menu: { view: menu, title: 'Menu' },
  week: { view: week, title: 'This week' },
};
const DEFAULT_ROUTE = 'tonight';

// Each message says what happened and what to do about it.
const BANNERS = {
  unavailable: {
    text: 'Your browser is blocking storage, so changes disappear when you close this tab. Export from the Menu before you close it.',
  },
  'save-failed': {
    text: "The last change couldn't be saved. Storage may be full or blocked. Export from the Menu to keep a copy, then free some space or try another browser.",
  },
  corrupt: {
    text: "The saved data couldn't be read, so Vesper started with the sample menu. A copy of the unreadable data is kept in this browser.",
    download: true,
  },
  'corrupt-unkept': {
    text: "The saved data couldn't be read, and no copy could be kept. Download it now: your next change replaces it.",
    download: true,
  },
  newer: {
    text: "This data was saved by a newer version of Vesper, so it is shown but not saved. Reload the page to get the latest version.",
    persistent: true,
  },
};

const view = document.getElementById('view');
const region = document.getElementById('banner-region');
const tabs = document.querySelectorAll('.tabs a');

let dismissedStatus = null;
let bannerKey = '';
let renderedDay = dayKey();

function routeName() {
  const name = location.hash.replace(/^#\/?/, '');
  return Object.prototype.hasOwnProperty.call(ROUTES, name) ? name : DEFAULT_ROUTE;
}

function renderBanner() {
  const status = store.getStatus();
  if (dismissedStatus !== null && dismissedStatus !== status) dismissedStatus = null;
  const banner = BANNERS[status];
  const key = banner && dismissedStatus !== status ? status : '';
  if (key === bannerKey) return; // rebuilding a live region would make screen readers repeat it
  bannerKey = key;
  if (!key) {
    region.replaceChildren();
    return;
  }
  const buttons = [];
  if (banner.download) {
    buttons.push(
      h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => storage.exportUnreadable(dayKey()) }, 'Download'),
    );
  }
  if (!banner.persistent) {
    buttons.push(
      h(
        'button',
        {
          class: 'btn btn-quiet btn-small',
          type: 'button',
          onclick: () => {
            dismissedStatus = status;
            renderBanner();
            view.querySelector('h1')?.focus({ preventScroll: true });
          },
        },
        'Dismiss',
      ),
    );
  }
  region.replaceChildren(h('div', { class: 'banner' }, h('p', {}, banner.text), h('div', { class: 'banner-actions' }, buttons)));
}

function renderApp({ moveFocus = false } = {}) {
  const name = routeName();
  const route = ROUTES[name];
  renderedDay = dayKey();

  view.replaceChildren();
  route.view.render(view);
  document.title = `${route.title} - Vesper`;

  for (const link of tabs) {
    if (link.getAttribute('href') === `#/${name}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  renderBanner();

  if (moveFocus) {
    window.scrollTo(0, 0);
    view.querySelector('h1')?.focus({ preventScroll: true });
  }
  applyFocus(view);
}

// Start-up, listeners and resume ------------------------------------------

store.init();
renderApp();

window.addEventListener('hashchange', () => renderApp({ moveFocus: true }));
store.subscribe(() => renderApp());
onRenderRequest(() => renderApp());

/**
 * A page that sat in the background (a phone locked overnight, a restored tab)
 * may have a different day, a different time of day or newer data in storage.
 */
function resume() {
  if (document.visibilityState !== 'visible') return;
  store.syncFromStorage();
  if (dayKey() !== renderedDay || document.querySelector('dialog[open]') === null) renderApp();
}
// The bottom bar can grow (large text wraps it onto two rows), so its real height
// feeds the scroll padding that keeps a focused element from hiding under it.
const tabBar = document.querySelector('.tabs');
if ('ResizeObserver' in window && tabBar) {
  new ResizeObserver(() => document.documentElement.style.setProperty('--tabs-h', `${tabBar.offsetHeight}px`)).observe(tabBar);
}

document.addEventListener('visibilitychange', resume);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) resume();
});

// Service worker ------------------------------------------------------------
// Registered on a real host, or on localhost when the URL has ?sw. Browsers do
// not offer service workers on plain http, so a phone on the local network skips it.
// ?sw=off on localhost removes Vesper's worker and its caches again.

const SW_URL = new URL('./sw.js', location.href).href;
const flag = new URLSearchParams(location.search).get('sw');
const onLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function removeServiceWorker() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  const ours = registrations.filter((r) => [r.active, r.waiting, r.installing].some((w) => w?.scriptURL === SW_URL));
  await Promise.all(ours.map((r) => r.unregister()));
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith('vesper-')).map((n) => caches.delete(n)));
}

if ('serviceWorker' in navigator) {
  if (onLocalhost && flag === 'off') {
    removeServiceWorker().catch(() => {});
  } else if (!onLocalhost || flag !== null) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('./sw.js');
        const registration = await navigator.serviceWorker.ready;
        // Ask the worker to fetch a fresh copy of every app file, all or nothing.
        registration.active?.postMessage('refresh');
      } catch {
        // The app works without it.
      }
    });
  }
}
