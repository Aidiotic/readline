# Deploying readline

Two things go out, and the order matters: the worker first, because the page
needs to be told where it is.

## 1. The reader

```bash
cd worker
npx wrangler login      # once, per machine — opens a browser
npm run deploy
```

Wrangler prints the URL it deployed to, something like
`https://readline.<your-subdomain>.workers.dev`. The subdomain is your
Cloudflare account's, not this project's, so it is whatever your other workers
already use.

Check it before going further:

```bash
curl https://readline.<your-subdomain>.workers.dev/health
curl "https://readline.<your-subdomain>.workers.dev/r/https://music.apple.com/us/album/1989-taylors-version/1708308989?__format=md"
```

The second should print an album with twenty-one tracks. If it prints an error
instead, the site is refusing us rather than the worker being broken — try
another link before assuming a deploy problem.

The free plan is enough. There are no bindings, no KV, no D1, nothing to
provision — the worker keeps no state at all beyond Cloudflare's own edge
cache, which needs no setup.

## 2. The page

Put the worker's URL in `config.js`:

```js
window.READLINE_CONFIG = {
  worker: 'https://readline.<your-subdomain>.workers.dev',
  ...
};
```

`config.js` is deliberately not bundled and not fingerprinted, so this can also
be edited straight from GitHub's web UI later without a rebuild.

Then push. `.github/workflows/pages.yml` publishes the repository root to
GitHub Pages on every push to `main` — there is no build step, so what is in
the repo is what is served.

One-time setup, in the repository's **Settings → Pages**: set the source to
**GitHub Actions**. The site then appears at
`https://<user>.github.io/readline/`.

## 3. Point them at each other

The worker's own landing page links back to the site, and takes the address
from a variable in `wrangler.toml`:

```toml
[vars]
SITE_URL = "https://aidiotic.github.io/readline/"
```

Change that if the page moves, and redeploy the worker.

## Taking it out of service

There are two switches, because there are two halves.

- **The page**: set `disabled: true` in `config.js` and edit the notice. This
  stops anyone making new links. It cannot reach tabs already loaded, and it
  does not affect links already shared — those are served by the worker.
- **The reader**: `cd worker && npx wrangler delete`, or disable the worker in
  the Cloudflare dashboard. This does stop links already shared, which is the
  point of it being separate.

## Watching it

```bash
cd worker && npm run tail
```

Observability is on in `wrangler.toml`, so requests and any thrown errors also
show up in the Cloudflare dashboard under the worker's **Logs**.

## Costs

Cloudflare's free plan gives 100,000 worker requests a day. A read is one
request plus one outbound fetch — two if the page was thin enough to be worth
asking its oEmbed endpoint. Repeat opens of the same shared link are served
from the edge cache for ten minutes and cost nothing.

The one thing that would change this is rendering pages in a headless browser,
which is on the roadmap and would be the first part of readline that is not
free.
