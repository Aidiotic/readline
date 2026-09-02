/* oEmbed, for the sites that hide behind it.

   Most pages describe themselves adequately in Open Graph and schema.org, and
   the generic path handles those. A handful of large sites do not: the HTML
   they serve to a fetcher is a shell, but their oEmbed endpoint answers
   honestly. Discovery via <link rel="alternate" type="…oembed"> is preferred;
   this table is the fallback for hosts that never advertise it. */

const TABLE = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'https://www.youtube.com/oembed?format=json&url='],
  [/(^|\.)open\.spotify\.com$/, 'https://open.spotify.com/oembed?url='],
  [/(^|\.)vimeo\.com$/, 'https://vimeo.com/api/oembed.json?url='],
  [/(^|\.)soundcloud\.com$/, 'https://soundcloud.com/oembed?format=json&url='],
  [/(^|\.)tiktok\.com$/, 'https://www.tiktok.com/oembed?url='],
  [/(^|\.)reddit\.com$/, 'https://www.reddit.com/oembed?url='],
  [/(^|\.)flickr\.com$/, 'https://www.flickr.com/services/oembed/?format=json&url='],
  [/(^|\.)giphy\.com$/, 'https://giphy.com/services/oembed?url='],
  [/(^|\.)ted\.com$/, 'https://www.ted.com/services/v1/oembed.json?url='],
  [/(^|\.)bsky\.app$/, 'https://embed.bsky.app/oembed?format=json&url='],
];

export function oembedEndpoint(pageURL) {
  let host;
  try { host = new URL(pageURL).hostname.toLowerCase(); } catch { return ''; }
  for (const [pattern, prefix] of TABLE) {
    if (pattern.test(host)) return prefix + encodeURIComponent(pageURL);
  }
  return '';
}

/* Never fatal. oEmbed is a bonus on top of the scrape, so a dead endpoint
   should cost nothing but the time already spent waiting on it. */
export async function fetchOembed(endpoint) {
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: 'application/json', 'user-agent': 'readline (+https://github.com/Aidiotic/readline)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/* A note we can show when a site is known to serve nothing useful to a
   non-browser, so the reader page explains itself rather than looking broken. */
const HOSTILE = [
  [/(^|\.)(x|twitter)\.com$/, 'X serves posts to logged-in browsers only, so there is rarely more here than the title.'],
  [/(^|\.)instagram\.com$/, 'Instagram blocks fetchers; expect the caption at best.'],
  [/(^|\.)facebook\.com$/, 'Facebook blocks fetchers; expect very little.'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn requires a login for most pages.'],
  [/(^|\.)music\.apple\.com$/, 'Apple Music renders in JavaScript; the listing below comes from the page’s own structured data.'],
  [/(^|\.)open\.spotify\.com$/, 'Spotify renders in JavaScript; the details below come from its oEmbed and metadata.'],
];

export function siteNote(pageURL) {
  let host;
  try { host = new URL(pageURL).hostname.toLowerCase(); } catch { return ''; }
  for (const [pattern, note] of HOSTILE) if (pattern.test(host)) return note;
  return '';
}
