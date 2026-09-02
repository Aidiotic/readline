/* Pure helpers. No DOM, no network — everything here is testable in isolation,
   which is why it never touches a browser global at load time. */

/* What people paste is rarely a well-formed URL. It is a bare host, or a link
   with tracking junk on it, or a whole "Check this out: https://…" sentence
   copied out of a message. All three should just work. */
export function normaliseLink(input) {
  let raw = String(input || '').trim();
  if (!raw) return '';

  // A URL pasted inside a sentence — take the first thing that looks like one.
  const embedded = /\bhttps?:\/\/\S+/i.exec(raw);
  if (embedded && embedded.index > 0) raw = embedded[0];

  raw = raw.replace(/^[<("'\s]+|[>)"'\s]+$/g, '');
  if (!raw) return '';

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    // A scheme we cannot fetch is worth rejecting rather than guessing at.
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    raw = `https://${raw}`;
  }

  try {
    const url = new URL(raw);
    return url.toString();
  } catch {
    return raw;
  }
}

export function looksLikeLink(input) {
  try {
    const url = new URL(normaliseLink(input));
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many || `${one}s`}`;
}

/* The share link is the product, so it is built the same way the worker
   parses it — raw and legible, with only the characters that would break the
   parse escaped. */
export function shareLink(workerBase, target) {
  const base = String(workerBase || '').replace(/\/+$/, '');
  const tail = String(target).replace(/[\s"'<>`{}\\^|]/g, (c) => encodeURIComponent(c));
  return `${base}/r/${tail}`;
}

/* A reading is a lot of fields; this is the one line that says what came back
   so someone can tell at a glance whether it was worth sharing. */
export function summarise(reading) {
  const bits = [];
  // Each section counted in its own unit — a recipe's six ingredients and its
  // five steps are eleven of nothing.
  for (const section of reading.sections) {
    bits.push(plural(section.items.length, section.unit || 'item'));
  }
  if (reading.stats.words) bits.push(plural(reading.stats.words, 'word'));
  if (reading.facts.length) bits.push(plural(reading.facts.length, 'fact'));
  // stats.links, not links.length — the API trims the array before sending it.
  if (reading.stats.links) bits.push(plural(reading.stats.links, 'link'));
  return bits.length ? `Extracted ${bits.join(' · ')}` : 'Extracted the page metadata only';
}
