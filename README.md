# readline

Paste any link and get one an AI can actually open.

Live at <https://aidiotic.github.io/readline/>.

Hand a model an Apple Music link and it gets an empty shell — the page is
built in JavaScript, and a fetcher does not run JavaScript. Hand it a readline
link to the same album and it gets the artist, the year, the genre and all
twenty-one track names with their durations, as plain HTML.

```
https://music.apple.com/us/album/1989-taylors-version/1708308989
                       ↓
https://readline.dropline.workers.dev/r/https://music.apple.com/us/album/1989-taylors-version/1708308989
```

## How it works

Two halves.

- **The page** (this repo's root) is static and lives on GitHub Pages. It takes
  a link, asks the reader about it, shows what came back, and hands over a
  link worth sharing. It could not do the reading itself even if it wanted to:
  a browser is not allowed to fetch `music.apple.com` from another origin.
- **The reader** (`worker/`) is a Cloudflare Worker. It fetches the page,
  pulls it apart, and serves the result as HTML **with no JavaScript in it at
  all**. That last part is the entire trick.

**Nothing is stored.** The reader link carries the original address inside it,
so there is no database, no id to expire, and no link that outlives the page it
points at. Repeat reads are served from Cloudflare's edge cache for ten
minutes. This is the same reasoning as dropline choosing P2P over a bucket: the
obvious "improvement" would undo the point.

## What it pulls out

In rough order of how much it is worth:

1. **schema.org / JSON-LD.** The reason this works at all. `MusicAlbum` gives
   a track list, `Recipe` gives ingredients and method, `Product` gives price
   and rating, `Event` gives dates and a venue, `QAPage` gives the answers.
2. **Open Graph and Twitter cards.** Title, description, cover art, type.
3. **oEmbed**, discovered from the page or from a small table of hosts that
   never advertise it. Only asked when the page came back thin — which is
   exactly when it helps. Spotify's shell `<title>` is "Spotify – Web Player"
   for every page it has; its oEmbed answer names the album.
4. **The readable text**, with navigation, footers, sidebars, scripts, forms
   and repeated furniture dropped.
5. **The links on the page**, deduplicated, off-site ones first.

Feeds (RSS/Atom), JSON endpoints and plain text are handled directly rather
than scraped.

## Reader links

```
/r/<the whole link>                    the readable page
/r/<the whole link>?__format=md        markdown
/r/<the whole link>?__format=json      the structured reading
/r/<the whole link>?__fresh=1          skip the cache
/r?u=<encoded link>&format=md          the unambiguous form, for scripts
/api/extract?url=<encoded link>        JSON, CORS open — what the page uses
```

The target is appended raw so it stays legible, which means its own query
string comes along with it. readline's own options are therefore namespaced
with a double underscore, so `?format=csv` on the target and `?__format=md`
for the reader cannot be confused. Use `?u=` if you would rather not think
about it.

## Limits, honestly

- **Pages whose text only exists after their own JavaScript runs** cannot be
  read. Structured data usually saves this; when it does not, the reader says
  so on the page rather than looking broken.
- **X, Instagram, LinkedIn and Facebook** serve almost nothing to a fetcher.
  You generally get the title and whatever is in the share card.
- **PDFs and images** are refused with a note. Extracting PDF text is on the
  roadmap.
- **Anything behind a login** stays behind it. readline has no credentials and
  is not a paywall bypass — it fetches exactly what an anonymous visitor gets.
- Pages are read up to 5 MB and 60,000 characters of text, and the fetch gives
  up after 15 seconds.

## Safety

The worker fetches whatever a stranger names, so the guard on that is the whole
security story:

- http and https only, no credentials in the URL.
- Private, loopback, link-local and carrier-grade-NAT addresses are refused —
  including the cloud metadata address, and including every alternate spelling
  (`2130706433`, `0x7f000001`, `127.1`, `[::ffff:7f00:1]` all collapse to the
  same integer first).
- Redirects are followed by hand, five at most, and **every hop is checked
  again** — `redirect: 'follow'` would happily walk from a public host onto
  `169.254.169.254`.
- The reader page is served under a CSP with `default-src 'none'` and no
  script source of any kind, so nothing smuggled through a page's title can run.

## Running it locally

```bash
npm test                       # 39 unit tests, no dependencies
npm run worker                 # the reader on :8787
npm run serve                  # the page on :4321
```

Then open `http://localhost:4321/?worker=http://localhost:8787`. The `worker`
override only accepts localhost, so a crafted link cannot point someone's
pastes at a stranger's server.

`worker/src` and `src` are ES modules loaded natively — **there is no build
step.** Edit and reload.

## Layout

```
index.html  style.css  config.js     the page
src/        app.js ui.js util.js     its logic — orchestration, DOM, pure helpers
worker/src/ index.js                 routing, caching, the non-HTML paths
            urls.js                  what we are allowed to fetch, and link parsing
            fetch.js                 fetching defensively
            extract.js               the walk of the document, and what a page *is*
            jsonld.js                schema.org into facts and lists
            providers.js             oEmbed, and notes for hostile hosts
            render.js                HTML, markdown, text, the failure page
test/                                the pure halves of all of the above
```

Sibling to [dropline](https://github.com/Aidiotic/dropline) and
[clearline](https://github.com/Aidiotic/clearline), and deliberately sharing
their visual language.

See [DEPLOYING.md](DEPLOYING.md) to put it somewhere, [TESTING.md](TESTING.md)
for what to check, and [/updates.html](updates.html) for what changed.
