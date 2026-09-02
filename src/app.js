/* readline — the page that makes the links.

   It does almost nothing on its own, and that is deliberate. A browser cannot
   fetch music.apple.com from this origin, and a link that has to be readable
   by something which does not run JavaScript cannot be rendered here either.
   So the worker does the reading; this page's whole job is to ask it, show
   what came back, and hand over a link worth sharing. */

import { bind, el, showView, setState, setStatus, announce, showError, showResult, flashButton } from './ui.js';
import { normaliseLink, looksLikeLink, hostOf, shareLink } from './util.js';

const CONFIG = window.READLINE_CONFIG || {};
const READ_TIMEOUT_MS = 25000;

let worker = '';
let busy = false;

boot();

function boot() {
  bind();
  wire();

  if (CONFIG.disabled) {
    showError(CONFIG.notice || 'readline is temporarily out of service.');
    el.errorReset.hidden = true;
    return;
  }

  worker = resolveWorker();
  el.footMeta.textContent = worker ? `reader · ${hostOf(worker)}` : 'no reader configured';

  // The page is linkable too: /?u=… reads straight away, which makes it
  // usable from a bookmarklet or a share sheet.
  const preset = new URLSearchParams(location.search).get('u');
  if (preset) {
    el.linkInput.value = preset;
    read(preset);
  } else {
    el.linkInput.focus();
  }
}

/* A `?worker=` override is genuinely useful when running the worker locally,
   but it would otherwise let a crafted link send whatever someone pastes to
   a stranger's server. Localhost only. */
function resolveWorker() {
  const override = new URLSearchParams(location.search).get('worker');
  if (override) {
    try {
      const url = new URL(override);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return url.origin;
    } catch { /* fall through to the configured one */ }
  }
  return String(CONFIG.worker || '').replace(/\/+$/, '');
}

function wire() {
  el.readForm.addEventListener('submit', (e) => {
    e.preventDefault();
    read(el.linkInput.value);
  });

  // Pasting a link is the whole interaction, so pasting one should be enough.
  el.linkInput.addEventListener('paste', (e) => {
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (looksLikeLink(pasted)) {
      e.preventDefault();
      el.linkInput.value = pasted.trim();
      read(pasted);
    }
  });

  el.copyBtn.addEventListener('click', async () => {
    const ok = await copy(el.shareLink.value);
    flashButton(el.copyBtn, ok ? 'Copied' : 'Press ⌘C', 'Copy link');
    if (!ok) { el.shareLink.focus(); el.shareLink.select(); }
  });

  if (navigator.share) {
    el.shareBtn.hidden = false;
    el.shareBtn.addEventListener('click', () => {
      navigator.share({ url: el.shareLink.value, title: el.cardTitle.textContent }).catch(() => {});
    });
  }

  el.againBtn.addEventListener('click', reset);
  el.errorReset.addEventListener('click', reset);
}

function reset() {
  setState('idle');
  setStatus('');
  showView('viewStart');
  el.linkInput.value = '';
  el.linkInput.focus();
  if (location.search) history.replaceState(null, '', location.pathname);
}

async function read(input) {
  if (busy) return;

  const target = normaliseLink(input);
  if (!looksLikeLink(target)) {
    showError('That does not look like a web link. Paste a full address, or a host like music.apple.com.');
    return;
  }
  if (!worker) {
    showError('No reader is configured. Deploy the worker and put its URL in config.js — see DEPLOYING.md.');
    return;
  }

  busy = true;
  el.actRead.disabled = true;
  setState('working');
  showView('viewStart');
  setStatus(`Reading ${hostOf(target)}…`);
  announce('Reading.');

  try {
    // The worker caches at the edge, which is where a repeat read should be
    // served from. Letting the browser cache it as well only means someone
    // who reads the same link twice gets an answer from before it changed.
    const res = await fetch(`${worker}/api/extract?url=${encodeURIComponent(target)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      showError((data && data.error) || `The reader answered ${res.status}.`);
      return;
    }

    setStatus('');
    showResult(data.reading, data.share || shareLink(worker, target));
  } catch (err) {
    // A failed cross-origin fetch is indistinguishable from an unreachable
    // host in the browser, so say both things rather than guessing.
    showError(err && err.name === 'TimeoutError'
      ? 'That page took too long to answer. It may be very large, or very slow.'
      : `Could not reach the reader at ${hostOf(worker)}. It may be down, or not deployed yet.`);
  } finally {
    busy = false;
    el.actRead.disabled = false;
    setStatus('');
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
