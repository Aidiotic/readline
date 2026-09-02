/* readline — the reader.

   One job: given somebody else's link, serve a page that says what is on the
   other end of it, in plain server-rendered HTML with no JavaScript. That is
   the whole trick. A model handed an Apple Music link gets a shell; handed a
   readline link to the same album, it gets the artist, the year and all
   twenty-one track names.

   Nothing is stored. The reader link carries the original URL inside it, so
   there is no database, no id to expire, and no link that outlives the page
   it points at. Same reasoning as dropline choosing P2P over a bucket. */

import { parseReaderURL, checkTarget, readerLink, BadTarget } from './urls.js';
import { fetchPage, FetchProblem } from './fetch.js';
import { scrape, assemble, decodeEntities } from './extract.js';
import { oembedEndpoint, fetchOembed, siteNote } from './providers.js';
import { renderHTML, renderMarkdown, renderText, renderError } from './render.js';
import { stripTags } from './jsonld.js';

const CACHE_SECONDS = 600;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = url.origin;

    if (request.method === 'OPTIONS') return preflight();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/robots.txt') {
      return text('User-agent: *\nAllow: /\n');
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return front(origin, env);

    if (url.pathname === '/api/extract') {
      return withCache(request, ctx, () => api(url, origin));
    }
    if (url.pathname === '/r' || url.pathname.startsWith('/r/')) {
      return withCache(request, ctx, () => reader(request, origin));
    }

    return renderError('No such page here. Reader links look like /r/<the link>.', { origin, status: 404 });
  },
};

/* ── routes ───────────────────────────────────────────────────────────── */

async function reader(request, origin) {
  const { target, format } = parseReaderURL(request.url);
  if (!target) {
    return renderError('That reader link has no address in it.', { origin, status: 400 });
  }

  let reading;
  try {
    reading = await read(target);
  } catch (err) {
    return failure(err, { target, origin });
  }

  if (format === 'json') return json({ ok: true, reading, share: readerLink(origin, target) });
  if (format === 'md') return text(renderMarkdown(reading), 'text/markdown');
  if (format === 'txt') return text(renderText(reading));

  return new Response(renderHTML(reading, { origin }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=60, s-maxage=${CACHE_SECONDS}`,
      'access-control-allow-origin': '*',
      'referrer-policy': 'no-referrer',
      // The reader page embeds the original's cover art and nothing else; no
      // script of any kind should ever run on it, including one smuggled
      // through a title we failed to escape.
      'content-security-policy':
        "default-src 'none'; img-src https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'",
      'x-content-type-options': 'nosniff',
    },
  });
}

async function api(url, origin) {
  const target = url.searchParams.get('url') || url.searchParams.get('u') || '';
  if (!target) return json({ ok: false, error: 'Pass ?url=' }, 400);

  try {
    const reading = await read(target);
    return json({
      ok: true,
      share: readerLink(origin, reading.target),
      reading: { ...reading, blocks: reading.blocks.slice(0, 6), links: reading.links.slice(0, 8) },
    });
  } catch (err) {
    const status = err instanceof BadTarget ? 400 : 502;
    return json({ ok: false, error: err.message || 'Could not read that page.' }, status);
  }
}

function front(origin, env) {
  const site = (env && env.SITE_URL) || 'https://aidiotic.github.io/readline/';
  const example = `${origin}/r/https://music.apple.com/us/album/1989-taylors-version/1708308989`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>readline</title><meta name="color-scheme" content="light dark">
<style>body{margin:0;padding:60px 24px;background:#F5EAD8;color:#201E1D;font:16px/1.6 ui-sans-serif,system-ui,sans-serif}
main{max-width:600px;margin:0 auto}code{background:#EEE7DB;padding:2px 6px;border-radius:5px;word-break:break-all}
a{color:#B2622D}@media(prefers-color-scheme:dark){body{background:#1B1815;color:#F5EAD8}code{background:#241F19}a{color:#F6A06B}}</style>
</head><body><main>
<h1>readline</h1>
<p>This is the reader. Put any link after <code>/r/</code> and it serves what is on the
other end as plain HTML, with no JavaScript — so anything that reads pages, including
a model, can see the contents.</p>
<p><a href="${escAttr(example)}">Try it on an Apple Music album →</a></p>
<p>Add <code>?__format=md</code> for markdown or <code>?__format=json</code> for structured JSON.</p>
<p>The page for making links is at <a href="${escAttr(site)}">${escAttr(site)}</a>.</p>
</main></body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}

/* ── the read itself ──────────────────────────────────────────────────── */

async function read(target) {
  checkTarget(target); // fail on a bad address before spending a fetch
  const page = await fetchPage(target);

  if (!page.mime.startsWith('text/html') && !page.mime.includes('xhtml')) {
    return plainReading(page, target);
  }

  const raw = await scrape(page.body, page.finalURL);
  let reading = assemble(raw, { target, finalURL: page.finalURL, mime: page.mime });

  // oEmbed costs a second round trip, so it is only worth it when the page
  // itself came back thin — which is exactly the case on the sites that have
  // an endpoint worth asking.
  const thin = reading.stats.words < 120 && reading.sections.length === 0;
  const endpoint = raw.rel.oembed || oembedEndpoint(page.finalURL);
  if (thin && endpoint) {
    const oembed = await fetchOembed(endpoint);
    if (oembed) reading = assemble(raw, { target, finalURL: page.finalURL, mime: page.mime, oembed });
  }

  const note = siteNote(page.finalURL);
  if (note && (thin || reading.sections.length)) reading.notes.unshift(note);
  if (page.chain.length > 1) {
    reading.notes.push(`That link redirected ${page.chain.length - 1} time${page.chain.length > 2 ? 's' : ''}, ending at ${page.finalURL}.`);
  }

  return reading;
}

/* JSON, plain text and feeds have no metadata to mine, but they are already
   readable — the job is only to present them. */
function plainReading(page, target) {
  const base = {
    target,
    finalURL: page.finalURL,
    canonical: '',
    fetchedAt: new Date().toISOString(),
    site: hostOf(page.finalURL),
    mime: page.mime,
    kind: page.mime,
    title: lastPathSegment(page.finalURL) || hostOf(page.finalURL),
    description: '',
    image: '',
    facts: [{ label: 'Source', value: hostOf(page.finalURL) }, { label: 'Type', value: page.mime }],
    sections: [],
    blocks: [],
    links: [],
    images: [],
    embedHTML: '',
    notes: [],
    stats: { words: 0, links: 0, listItems: 0 },
  };

  if (page.mime.includes('json')) {
    try {
      const pretty = JSON.stringify(JSON.parse(page.body), null, 2);
      base.blocks = [{ tag: 'pre', text: pretty.slice(0, 40000) }];
    } catch {
      base.blocks = [{ tag: 'pre', text: page.body.slice(0, 40000) }];
    }
  } else if (/xml|rss|atom|feed/.test(page.mime)) {
    const items = feedItems(page.body);
    base.kind = 'Feed';
    base.title = firstTag(page.body, 'title') || base.title;
    if (items.length) {
      base.sections = [{ title: 'Entries', numbered: false, items }];
      base.facts.push({ label: 'Entries', value: String(items.length) });
    } else {
      base.blocks = [{ tag: 'p', text: stripTags(page.body).slice(0, 40000) }];
    }
  } else {
    base.blocks = page.body.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)
      .slice(0, 400).map((t) => ({ tag: 'p', text: t.slice(0, 4000) }));
  }

  base.stats.words = base.blocks.map((b) => b.text).join(' ').split(/\s+/).filter(Boolean).length;
  return base;
}

/* A feed is regular enough that a parser would be more machinery than it is
   worth; the shapes below are the whole of RSS 2.0 and Atom that matters. */
function feedItems(xml) {
  const out = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < 100) {
    const chunk = m[0];
    const title = decodeEntities(stripTags(firstTag(chunk, 'title')));
    if (!title) continue;
    const href = firstTag(chunk, 'link') || (/<link[^>]*href="([^"]+)"/i.exec(chunk) || [])[1] || '';
    const when = firstTag(chunk, 'pubDate') || firstTag(chunk, 'updated') || firstTag(chunk, 'published');
    out.push({ title, href: decodeEntities(href).trim(), meta: stripTags(when).slice(0, 40) });
  }
  return out;
}

function firstTag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function lastPathSegment(u) {
  try { return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || ''); } catch { return ''; }
}

/* ── plumbing ─────────────────────────────────────────────────────────── */

function failure(err, { target, origin }) {
  if (err instanceof BadTarget) return renderError(err.message, { target, origin, status: 400 });
  if (err instanceof FetchProblem) return renderError(err.message, { target, origin, status: 502 });
  if (err && err.name === 'TimeoutError') {
    return renderError('That page took too long to answer.', { target, origin, status: 504 });
  }
  return renderError('Something went wrong reading that page.', { target, origin, status: 502 });
}

/* The edge cache does the deduplication a store would otherwise be for: the
   tenth person to open the same shared link costs no fetch at all. */
async function withCache(request, ctx, produce) {
  const url = new URL(request.url);
  const fresh = url.searchParams.has('__fresh') || url.searchParams.has('fresh');
  const cache = caches.default;
  const key = new Request(url.toString(), { method: 'GET' });

  if (!fresh) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  const res = await produce();
  if (res.ok && res.status === 200) {
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=60, s-maxage=${CACHE_SECONDS}` : 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function text(body, type = 'text/plain') {
  return new Response(body, {
    headers: {
      'content-type': `${type}; charset=utf-8`,
      'cache-control': `public, max-age=60, s-maxage=${CACHE_SECONDS}`,
      'access-control-allow-origin': '*',
    },
  });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
