/* Pulling a page apart.

   Two halves, deliberately separated. `scrape` is the only part that needs
   HTMLRewriter — it walks the document once and collects raw bits. `assemble`
   is pure, takes those bits, and decides what the page actually *is*. The
   split is why the interesting logic can be tested without a Workers runtime. */

import { parseBlocks, shape, stripTags, duration } from './jsonld.js';

/* Regions that are furniture. Their text is repeated on every page of a site
   and drowns the part someone wanted. `header` is not on the list — on an
   article it usually holds the headline. */
const SKIP = 'script, style, noscript, template, svg, iframe, form, button, select, nav, footer, aside';

const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, figcaption, td, th, summary';

const MAX_CHARS = 60000;
const MAX_LINKS = 200;
const MAX_IMAGES = 40;

export async function scrape(html, baseURL) {
  const out = {
    title: '',
    meta: {},
    rel: {},
    ld: [],
    blocks: [],
    links: [],
    images: [],
    truncated: false,
  };

  let skipDepth = 0;
  let buf = '';
  let tag = 'p';
  let chars = 0;
  const seen = new Set();

  const flush = () => {
    const t = decodeEntities(buf).replace(/\s+/g, ' ').trim();
    buf = '';
    if (t.length < 2 || chars >= MAX_CHARS) return;
    // Site furniture that escaped the skip list shows up as the same short
    // string over and over; keeping one copy is always right.
    const key = t.length < 120 ? t.toLowerCase() : '';
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.blocks.push({ tag, text: t });
    chars += t.length;
    if (chars >= MAX_CHARS) out.truncated = true;
  };

  const rewriter = new HTMLRewriter()
    .on('title', { text: (t) => { out.title += t.text; } })

    .on('meta', {
      element(el) {
        const name = (el.getAttribute('property') || el.getAttribute('name') || el.getAttribute('itemprop') || '').toLowerCase();
        const content = el.getAttribute('content');
        if (name && content && !out.meta[name]) out.meta[name] = decodeEntities(content).trim();
      },
    })

    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        const href = el.getAttribute('href');
        if (!rel || !href) return;
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (rel.includes('canonical')) out.rel.canonical = abs(href, baseURL);
        if (rel.includes('alternate') && type.includes('oembed')) out.rel.oembed = abs(href, baseURL);
        if (rel.includes('icon') && !out.rel.icon) out.rel.icon = abs(href, baseURL);
      },
    })

    .on('script[type="application/ld+json"]', {
      element() { out.ld.push(''); },
      text(t) { if (out.ld.length) out.ld[out.ld.length - 1] += t.text; },
    })

    .on(SKIP, {
      element(el) {
        skipDepth++;
        el.onEndTag(() => { skipDepth--; });
      },
    })

    // A boundary at the start and the end of every block keeps sentences from
    // running into their neighbours when the markup has no whitespace.
    .on(BLOCK, {
      element(el) {
        if (skipDepth) return;
        flush();
        tag = el.tagName.toLowerCase();
        el.onEndTag(() => { flush(); tag = 'p'; });
      },
    })
    .on('br', { element() { if (!skipDepth) buf += ' '; } })

    .on('a[href]', {
      element(el) {
        if (skipDepth || out.links.length >= MAX_LINKS) return;
        const href = abs(el.getAttribute('href'), baseURL);
        if (!href || !/^https?:/.test(href)) return;
        out.links.push({ href, text: '' });
      },
      text(t) {
        const last = out.links[out.links.length - 1];
        if (last && last.text.length < 200) last.text += t.text;
      },
    })

    .on('img[src]', {
      element(el) {
        if (skipDepth || out.images.length >= MAX_IMAGES) return;
        const src = abs(el.getAttribute('src') || el.getAttribute('data-src'), baseURL);
        if (src) out.images.push({ src, alt: (el.getAttribute('alt') || '').trim() });
      },
    })

    .on('*', {
      text(t) {
        if (skipDepth || chars >= MAX_CHARS) return;
        buf += t.text;
      },
    });

  // The handlers only run as the body is consumed, so the buffer has to be
  // drained even though the transformed output is thrown away.
  await rewriter.transform(new Response(html)).arrayBuffer();
  flush();

  out.title = decodeEntities(out.title).replace(/\s+/g, ' ').trim();
  for (const l of out.links) l.text = decodeEntities(l.text).replace(/\s+/g, ' ').trim();
  return out;
}

/* HTMLRewriter hands text back exactly as it appeared in the source, entities
   and all, so "Policy &amp; Safety" would reach the reader page looking like
   that. One pass over the whole string, never a chain of replaces — decoding
   &amp; separately would turn a literal "&amp;lt;" into a tag. */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•',
  hellip: '…', mdash: '—', ndash: '–', minus: '−', times: '×', divide: '÷',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  sbquo: '‚', bdquo: '„', dagger: '†', Dagger: '‡', permil: '‰',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', prime: '′', Prime: '″',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
  frac12: '½', frac14: '¼', frac34: '¾', plusmn: '±', ne: '≠', le: '≤', ge: '≥',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ouml: 'ö', uuml: 'ü',
  auml: 'ä', szlig: 'ß', ntilde: 'ñ', oslash: 'ø', aring: 'å', ae: 'æ',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '',
};

export function decodeEntities(s) {
  return String(s).replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Lone surrogates and out-of-range code points throw; leave those alone.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : whole;
  });
}

function abs(href, baseURL) {
  if (!href) return '';
  try { return new URL(href, baseURL).toString(); } catch { return ''; }
}

/* ── from raw bits to a reading ────────────────────────────────────────── */

export function assemble(raw, { target, finalURL, mime, oembed = null } = {}) {
  const m = raw.meta || {};
  const ld = shape(parseBlocks(raw.ld || []));
  const site = hostOf(finalURL || target);

  /* oEmbed outranks the document title on purpose. A single-page app serves
     one <title> for every page it has — Spotify's is "Spotify – Web Player"
     whatever you asked for — while its oEmbed answer names the actual album. */
  const title = firstOf(
    ld.name,
    m['og:title'],
    m['twitter:title'],
    oembed && oembed.title,
    cleanTitle(raw.title, m['og:site_name']),
    finalURL || target,
  );

  const description = firstOf(
    ld.description,
    m['og:description'],
    m['twitter:description'],
    m.description,
  );

  // What the page is, said once. The kicker on the reader page already shows
  // it, so repeating it as a fact would just be noise.
  const kind = ld.label || prettyType(m['og:type']) || '';

  const facts = [];
  const push = (label, value, href) => {
    const v = String(value || '').trim();
    // og:type spells it "music.album" where schema.org says "MusicAlbum";
    // both come out as the same words, so compare loosely.
    if (!v || (label === 'Type' && v.toLowerCase() === kind.toLowerCase())) return;
    if (!facts.some((f) => f.label === label)) facts.push({ label, value: v, href: href || '' });
  };

  push('Source', m['og:site_name'] || site);
  for (const f of ld.facts) push(f.label, f.value, f.href);
  push('Type', prettyType(m['og:type']));
  push('By', m['article:author'] || m['author'] || m['twitter:creator'] || (oembed && oembed.author_name));
  push('Published', m['article:published_time'] || m['datePublished']);
  push('Updated', m['article:modified_time']);
  push('Length', duration(m['music:duration'] || m['video:duration']) || durationFromSeconds(m['music:duration'] || m['video:duration']));
  push('Section', m['article:section']);
  push('Tags', m['keywords'] || m['article:tag']);

  // og description is often a summary of exactly the facts a music or video
  // page will not otherwise state ("Album · 2023 · 21 Songs").
  if (!ld.kind && m['og:description'] && /·/.test(m['og:description'])) {
    push('Summary', m['og:description']);
  }

  const allLinks = dedupeLinks(raw.links || [], finalURL || target);
  const links = allLinks.slice(0, 60);
  const blocks = dropBoilerplate(raw.blocks || [], title);
  const bodyText = blocks.map((b) => b.text).join('\n');
  const words = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  const notes = [];
  if (raw.truncated) notes.push('The page was longer than the read limit; this is the first part of it.');
  if (!words && !ld.sections.length) {
    notes.push('This page holds no readable text of its own — everything below came from its metadata.');
  }

  return {
    target,
    finalURL: finalURL || target,
    canonical: raw.rel && raw.rel.canonical,
    fetchedAt: new Date().toISOString(),
    site,
    mime,
    kind,
    title: title.slice(0, 300),
    description: decodeEntities(stripTags(description)).slice(0, 1200),
    image: firstOf(ld.image, m['og:image'], m['twitter:image'], oembed && oembed.thumbnail_url),
    facts,
    sections: ld.sections,
    blocks,
    links,
    images: (raw.images || []).filter((i) => i.alt),
    embedHTML: oembed && typeof oembed.html === 'string' ? oembed.html : '',
    notes,
    // Counted here rather than from the arrays, because the API trims those
    // down before sending them and the count would then describe the trim.
    stats: {
      words,
      links: allLinks.length,
      listItems: ld.sections.reduce((n, s) => n + s.items.length, 0),
    },
  };
}

function firstOf(...values) {
  for (const v of values) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) return s;
  }
  return '';
}

/* "1989 (Taylor's Version) by Taylor Swift on Apple Music" is fine, but
   "Some Article | Site Name" is better without the tail. */
function cleanTitle(title, siteName) {
  let t = String(title || '').trim();
  if (siteName) {
    const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\s*[|–—·-]\\s*${esc}\\s*$`, 'i'), '');
  }
  return t.trim();
}

function prettyType(t) {
  if (!t) return '';
  return String(t).replace(/^(og:|website$)/, '').replace(/[._]/g, ' ').trim();
}

function durationFromSeconds(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const m = Math.floor(n / 60);
  return `${m}:${String(Math.round(n % 60)).padStart(2, '0')}`;
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/* The title tends to appear again as an h1, and cookie or app-store nags
   survive the skip list because they are ordinary paragraphs. */
const NAG = /^(accept (all )?cookies|we use cookies|sign in|log in|subscribe|open in app|get the app|advertisement|skip to (main )?content)\b/i;

function dropBoilerplate(blocks, title) {
  const t = title.toLowerCase().trim();
  const out = [];
  let droppedTitle = false;
  for (const b of blocks) {
    if (NAG.test(b.text)) continue;
    if (!droppedTitle && /^h[12]$/.test(b.tag) && b.text.toLowerCase().trim() === t) {
      droppedTitle = true;
      continue;
    }
    out.push(b);
  }
  return out;
}

/* Same destination linked from three places is one link. Off-site links are
   worth more than another route into the same site, so they sort first. */
function dedupeLinks(links, baseURL) {
  const host = hostOf(baseURL);
  const byHref = new Map();
  for (const l of links) {
    if (!l.text || l.text.length < 2) continue;
    if (!byHref.has(l.href)) byHref.set(l.href, l);
  }
  const all = [...byHref.values()];
  const external = all.filter((l) => hostOf(l.href) !== host);
  const internal = all.filter((l) => hostOf(l.href) === host);
  return [...external, ...internal];
}
