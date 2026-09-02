# Testing readline

## Unit tests

```bash
npm test
```

39 tests, no dependencies — `node --test` over `test/*.test.js`. They cover
the pure halves of everything:

| file | what it holds down |
| --- | --- |
| `urls.test.js` | the fetch guard, and reader links surviving a round trip |
| `jsonld.test.js` | schema.org into facts and lists — the album, the recipe, the product |
| `assemble.test.js` | what a page *is*, given the raw bits, plus the page's own helpers |
| `entities.test.js` | the entity decoder, including not decoding twice |

The guard gets the most attention because it is the whole security story of a
worker that fetches whatever a stranger names. If you touch `urls.js`, run
these before anything else.

**What is not unit-tested:** `scrape` in `extract.js`, because it needs
HTMLRewriter and only exists inside a Workers runtime. That split is
deliberate — `scrape` collects raw bits and makes no decisions, and everything
that decides anything is in `assemble`, which is pure. Check `scrape` with the
live reads below.

## Live checks

Start the reader:

```bash
npm run worker      # :8787
```

Each of these should hold. They are ordered so that a failure tells you
something different from the one above it.

**The case the project exists for** — an Apple Music album, which has no
readable text at all and renders in JavaScript:

```bash
curl "http://127.0.0.1:8787/r/https://music.apple.com/us/album/1989-taylors-version/1708308989?__format=md"
```

Expect a title, artist, genre, date, and **21 numbered tracks with durations
and per-song links**, then the editorial review as body text. If the tracks are
missing but the title is there, the JSON-LD path broke, not the fetch.

**A recipe** — the other structured-data shape worth having:

```bash
curl "http://127.0.0.1:8787/r/https://www.bbcgoodfood.com/recipes/easy-pancakes?__format=md"
```

Expect `Prep: 10 min` and `Cook: 20 min` — **as words, not as `10:00`** — then
an ingredients list and a numbered method with the `HowToSection` wrapper
flattened away.

**A feed**, which takes the non-HTML path entirely:

```bash
curl "http://127.0.0.1:8787/r/https://hnrss.org/frontpage?__format=md"
```

Expect an `Entries` section with titles, dates and links.

**A site that hides behind oEmbed.** Spotify serves the same shell `<title>`
for every page it has:

```bash
curl "http://127.0.0.1:8787/r/https://open.spotify.com/album/1Mo4aZ8pdj6L1jx8zSwJnt?__format=md"
```

Expect the **album name**, not "Spotify – Web Player". This is the one check
that proves oEmbed outranks the document title.

**A hostile site**, which should degrade rather than fail:

```bash
curl "http://127.0.0.1:8787/r/https://x.com/jack/status/20?__format=md"
```

Expect the post text from the share card, plus the note explaining why there is
not more.

**Failures should be legible, not generic:**

```bash
curl "http://127.0.0.1:8787/r/https://nothing-here-9x8y7z.example/" | grep desc
# → Could not reach nothing-here-9x8y7z.example. Check the address…

curl -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8787/r/http://169.254.169.254/latest/meta-data/"
# → 400
```

### Caching will lie to you

Two caches sit in front of a change, and both have caught this project out:

- **The worker's own edge cache** persists to `worker/.wrangler/state` and
  **survives a restart**, so a fix can look like it did nothing. Append
  `?__fresh=1`, or `rm -rf worker/.wrangler/state` and restart.
- **The browser's HTTP cache** held API responses until the page was changed to
  request them with `cache: 'no-store'`.

If a change appears to have no effect, suspect these before the code.

## The page

```bash
npm run serve       # :4321
```

Open `http://localhost:4321/?worker=http://localhost:8787`. The override only
accepts localhost by design; against the deployed worker, drop it.

Check by hand:

- Pasting a link **reads immediately**, without pressing anything.
- The clay square spins while waiting and settles when the answer lands.
- The card shows the kicker as `music.apple.com · Music Album` — **not**
  `MUSICALBUM`, and not with a duplicate `Type` row beneath it.
- The counts under the card describe the whole reading, not the trimmed copy
  the API sends: `21 tracks · 1,096 words · 6 facts · 164 links`.
- The list ends `and 16 more`.
- **Copy link** puts the reader link on the clipboard and says `Copied`.
- A nonsense entry (`hello there`) gives the "does not look like a web link"
  message without a round trip.
- `?u=<link>` on the page URL reads on load.

Then open the reader link itself and confirm the page has **no console errors**
— the CSP is `default-src 'none'`, so anything that tries to run will say so
loudly.

## Before deploying

```bash
npm test
```

and read one Apple Music link end to end through the page. That single path
touches the guard, the fetch, HTMLRewriter, the JSON-LD shaping, the renderer
and the front page at once.
