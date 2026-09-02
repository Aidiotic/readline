/* Fetching someone else's page, defensively.

   Three things go wrong constantly and each needs its own answer: sites
   redirect (possibly onto a private address), sites are enormous, and sites
   turn away anything that does not look like a browser. */

import { checkTarget, BadTarget } from './urls.js';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;

/* Chrome on macOS. Not a disguise so much as a password: a great many sites
   serve a stub or a 403 to anything else, and there is no content to extract
   from a stub. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const READABLE = [
  'text/html', 'application/xhtml', 'text/plain', 'text/markdown',
  'application/json', 'application/ld+json', 'text/xml', 'application/xml',
  'application/rss', 'application/atom', 'application/feed',
];

export class FetchProblem extends Error {
  constructor(message, { status = 0, finalURL = '' } = {}) {
    super(message);
    this.status = status;
    this.finalURL = finalURL;
  }
}

/* Follows redirects by hand. `redirect: 'follow'` would happily walk from a
   public host onto 169.254.169.254, and by the time the response comes back
   the hop that mattered is invisible. */
export async function fetchPage(target, { headers = {} } = {}) {
  let url = checkTarget(target);
  const chain = [url.toString()];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await attempt(url, {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'upgrade-insecure-requests': '1',
      ...headers,
    });

    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!location) {
      return await readBody(res, url, chain);
    }

    let next;
    try {
      next = new URL(location, url);
    } catch {
      throw new FetchProblem('That page redirected somewhere unparseable.', { finalURL: url.toString() });
    }
    url = checkTarget(next.toString());
    chain.push(url.toString());
  }

  throw new FetchProblem('That page redirects in a loop.', { finalURL: url.toString() });
}

/* A fetch that never gets an answer throws a bare TypeError, and "Something
   went wrong" is no help at all when the real problem is a typo in the host. */
async function attempt(url, headers) {
  try {
    return await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers,
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new FetchProblem('That page took too long to answer.', { finalURL: url.toString() });
    }
    throw new FetchProblem(`Could not reach ${url.hostname}. Check the address, or the site may be down.`, {
      finalURL: url.toString(),
    });
  }
}

async function readBody(res, url, chain) {
  const finalURL = url.toString();

  if (res.status === 401 || res.status === 403) {
    throw new FetchProblem('That page refused the request — it is behind a login or a bot check.', {
      status: res.status, finalURL,
    });
  }
  if (res.status === 429) {
    throw new FetchProblem('That site is rate-limiting us. Try again in a minute.', { status: 429, finalURL });
  }
  if (!res.ok) {
    throw new FetchProblem(`That page returned ${res.status}.`, { status: res.status, finalURL });
  }

  const type = (res.headers.get('content-type') || '').toLowerCase();
  const mime = type.split(';')[0].trim();
  if (mime && !READABLE.some((ok) => mime.startsWith(ok))) {
    throw new FetchProblem(`That link is ${mime}, not a page — there is no text in it to pull out.`, {
      status: res.status, finalURL,
    });
  }

  // Trusting content-length would let a lying header through; count instead.
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) {
    throw new FetchProblem('That page is too large to read.', { status: res.status, finalURL });
  }

  const body = await readCapped(res);

  return { body, mime: mime || 'text/html', status: res.status, finalURL, chain, headers: res.headers };
}

/* Stops pulling at the cap rather than buffering the whole thing first, so a
   hostile or merely enormous response cannot exhaust the isolate. A truncated
   page still extracts fine — the head is where the metadata lives. */
async function readCapped(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        chunks.push(value.slice(0, value.byteLength - (total - MAX_BYTES)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(total > MAX_BYTES ? MAX_BYTES : total);
  let at = 0;
  for (const c of chunks) { joined.set(c, at); at += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(joined);
}

export { BadTarget };
