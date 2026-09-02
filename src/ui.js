/* Everything that touches the DOM. */

import { hostOf, summarise } from './util.js';

export const el = {};

export function bind() {
  const ids = [
    'app', 'statusline', 'live', 'view-start', 'view-result', 'view-error',
    'read-form', 'link-input', 'act-read',
    'card-kicker', 'card-title', 'card-desc', 'card-facts', 'card-list', 'card-stats',
    'share-link', 'copy-btn', 'share-btn', 'open-btn', 'again-btn',
    'error-msg', 'error-reset', 'foot-meta',
  ];
  for (const id of ids) el[camel(id)] = document.getElementById(id);
  return el;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const VIEWS = ['viewStart', 'viewResult', 'viewError'];

export function showView(name) {
  for (const v of VIEWS) el[v].hidden = v !== name;
}

export function setState(state) {
  el.app.dataset.state = state;
}

export function setStatus(text) {
  el.statusline.textContent = text || '';
}

// Screen readers need the change announced; the status line alone is silent.
export function announce(text) {
  el.live.textContent = text;
}

export function showError(message) {
  el.errorMsg.textContent = message;
  setState('failed');
  showView('viewError');
  announce(message);
}

/* The card is the receipt: proof that something real came back, before anyone
   is asked to share it. Which is why it shows the extracted facts rather than
   a screenshot or a bare "done". */
export function showResult(reading, share) {
  el.cardKicker.textContent = [hostOf(reading.finalURL), reading.kind].filter(Boolean).join(' · ');
  el.cardTitle.textContent = reading.title;
  el.cardDesc.textContent = reading.description || '';
  el.cardDesc.hidden = !reading.description;

  el.cardFacts.replaceChildren();
  for (const fact of reading.facts.slice(0, 6)) {
    if (fact.label === 'Source') continue; // already in the kicker
    const dt = document.createElement('dt');
    dt.textContent = fact.label;
    const dd = document.createElement('dd');
    dd.textContent = fact.value;
    dd.title = fact.value;
    el.cardFacts.append(dt, dd);
  }

  el.cardList.replaceChildren();
  const section = reading.sections[0];
  if (section) {
    for (const item of section.items.slice(0, 5)) {
      const li = document.createElement('li');
      li.textContent = item.meta ? `${item.title} — ${item.meta}` : item.title;
      el.cardList.append(li);
    }
    if (section.items.length > 5) {
      const li = document.createElement('li');
      li.className = 'more';
      li.textContent = `and ${(section.items.length - 5).toLocaleString()} more`;
      el.cardList.append(li);
    }
  }

  el.cardStats.textContent = summarise(reading);

  el.shareLink.value = share;
  el.openBtn.href = share;

  setState('ready');
  showView('viewResult');
  announce(`Read ${reading.title}. ${summarise(reading)}.`);
}

/* Feedback has to be on the button itself — a status line at the top of the
   page is nowhere near where the eye is when it is pressed. */
export function flashButton(button, message, revertTo) {
  button.textContent = message;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = revertTo;
    button.disabled = false;
  }, 1400);
}
