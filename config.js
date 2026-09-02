/* Runtime configuration. Deliberately not bundled, so it can be edited on a
   deployed site without touching anything else — including straight from
   GitHub's web UI, which takes about thirty seconds. */

window.READLINE_CONFIG = {
  // ── the reader ──
  // Where the worker lives. This is the only setting that has to be right:
  // the page cannot read anything without it, because a browser is not
  // allowed to fetch music.apple.com from a different origin, and a shared
  // link has to be served by something that renders on the server.
  //
  // After `npm run deploy` in worker/, wrangler prints the URL. Paste it here.
  worker: 'https://readline.aidiotic.workers.dev',

  // ── kill switch ──
  // Set to true to stop the page reading anything, with the notice below
  // shown instead. It cannot reach tabs that are already loaded, and it does
  // not disable reader links that are already out in the world — those are
  // served by the worker, so take that down instead.
  disabled: false,
  notice: 'readline is temporarily out of service. Back shortly.',
};
