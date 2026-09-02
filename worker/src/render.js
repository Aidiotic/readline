/* Turning a reading into something to serve.

   The HTML here has no JavaScript in it at all, and that is the entire point
   of the project: the thing on the far end of a shared link may well be a
   fetcher that never runs a script. Everything it needs is in the markup, in
   reading order, with the facts before the prose. */

import { readerLink } from './urls.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `
:root{--paper:#F5EAD8;--raised:#EEE7DB;--ink:#201E1D;--muted:#82796A;--faint:#C0B6A5;
--rule:#DCD3C4;--clay:#C67139;--clay-strong:#B2622D}
@media (prefers-color-scheme:dark){:root{--paper:#1B1815;--raised:#241F19;--ink:#F5EAD8;
--muted:#A89D8A;--faint:#4A4234;--rule:#372F26;--clay-strong:#F6A06B}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:44px 24px 72px;background:var(--paper);color:var(--ink);
font:16px/1.62 "Figtree",ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}
article{max-width:680px;margin:0 auto}
h1{font-family:"Caprasimo",Georgia,serif;font-weight:400;font-size:clamp(26px,5.4vw,36px);
line-height:1.16;letter-spacing:-.015em;margin:0 0 14px;text-wrap:pretty}
h2{font-family:"Caprasimo",Georgia,serif;font-weight:400;font-size:19px;letter-spacing:-.01em;
margin:46px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
a{color:var(--clay-strong);text-decoration:none;border-bottom:1px solid var(--faint)}
a:hover{border-bottom-color:var(--clay-strong)}
.from{display:flex;align-items:center;gap:10px;margin:0 0 26px;font-size:12.5px;color:var(--muted)}
.mark{width:12px;height:12px;border-radius:3px;background:var(--clay);flex:none}
.desc{margin:0 0 26px;font-size:17px;color:var(--muted);text-wrap:pretty}
.cover{max-width:260px;width:100%;border-radius:14px;display:block;margin:0 0 26px}
dl.facts{display:grid;grid-template-columns:auto 1fr;gap:7px 20px;margin:0 0 8px;font-size:14.5px}
dl.facts dt{color:var(--muted)}
dl.facts dd{margin:0}
ol.items,ul.items{margin:0;padding-left:1.4em}
ol.items li,ul.items li{margin:0 0 7px;padding-left:4px}
ol.items li::marker,ul.items li::marker{color:var(--faint)}
.meta{color:var(--muted);font-size:13.5px}
.body p{margin:0 0 16px;text-wrap:pretty}
.body h3{font-size:16.5px;font-weight:700;margin:30px 0 10px}
.body blockquote{margin:0 0 16px;padding-left:16px;border-left:2px solid var(--rule);color:var(--muted)}
.body pre{overflow-x:auto;padding:14px 16px;border-radius:10px;background:var(--raised);
font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.note{margin:0 0 20px;padding:11px 14px;border-left:2px solid var(--clay);background:var(--raised);
border-radius:0 8px 8px 0;font-size:13.5px;color:var(--muted)}
.links li{margin-bottom:8px;font-size:14.5px}
.links .href{display:block;color:var(--faint);font-size:11.5px;word-break:break-all}
footer{margin-top:52px;padding-top:18px;border-top:1px solid var(--rule);font-size:12.5px;
color:var(--muted);word-break:break-word}
footer a{border-bottom-color:var(--rule)}
`;

export function renderHTML(r, { origin }) {
  const md = `${readerLink(origin, r.target)}?__format=md`;
  const json = `${readerLink(origin, r.target)}?__format=json`;
  const p = [];

  p.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">');
  p.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  p.push('<meta name="color-scheme" content="light dark">');
  p.push(`<title>${esc(r.title)}</title>`);
  if (r.description) p.push(`<meta name="description" content="${esc(r.description.slice(0, 300))}">`);
  p.push(`<link rel="alternate" type="text/markdown" href="${esc(md)}">`);
  p.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  p.push('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;700&display=swap">');
  p.push(`<style>${CSS}</style></head><body><article>`);

  p.push(`<p class="from"><span class="mark"></span>Read by readline from <a href="${esc(r.finalURL)}">${esc(r.site)}</a>`
    + `${r.kind ? ` · ${esc(r.kind)}` : ''}</p>`);

  p.push(`<h1>${esc(r.title)}</h1>`);
  if (r.description) p.push(`<p class="desc">${esc(r.description)}</p>`);
  for (const note of r.notes) p.push(`<p class="note">${esc(note)}</p>`);
  if (r.image) p.push(`<img class="cover" src="${esc(r.image)}" alt="">`);

  if (r.facts.length) {
    p.push('<dl class="facts">');
    for (const f of r.facts) {
      const v = f.href ? `<a href="${esc(f.href)}">${esc(f.value)}</a>` : esc(f.value);
      p.push(`<dt>${esc(f.label)}</dt><dd>${v}</dd>`);
    }
    p.push('</dl>');
  }

  for (const s of r.sections) {
    p.push(`<h2>${esc(s.title)}</h2>`);
    const tag = s.numbered ? 'ol' : 'ul';
    p.push(`<${tag} class="items">`);
    for (const it of s.items) {
      const title = it.href ? `<a href="${esc(it.href)}">${esc(it.title)}</a>` : esc(it.title);
      p.push(`<li>${title}${it.meta ? ` <span class="meta">${esc(it.meta)}</span>` : ''}</li>`);
    }
    p.push(`</${tag}>`);
  }

  if (r.blocks.length) {
    p.push('<h2>Page text</h2><div class="body">');
    p.push(blocksToHTML(r.blocks));
    p.push('</div>');
  }

  if (r.links.length) {
    p.push('<h2>Links on the page</h2><ul class="items links">');
    for (const l of r.links) {
      p.push(`<li><a href="${esc(l.href)}">${esc(l.text)}</a><span class="href">${esc(l.href)}</span></li>`);
    }
    p.push('</ul>');
  }

  p.push('<footer>');
  p.push(`Original: <a href="${esc(r.finalURL)}">${esc(r.finalURL)}</a><br>`);
  p.push(`Read ${esc(r.fetchedAt.replace('T', ' ').slice(0, 19))} UTC · `);
  p.push(`<a href="${esc(md)}">markdown</a> · <a href="${esc(json)}">json</a>`);
  p.push('</footer></article></body></html>');

  return p.join('');
}

function blocksToHTML(blocks) {
  const out = [];
  let inList = false;
  for (const b of blocks) {
    const isItem = b.tag === 'li' || b.tag === 'dd' || b.tag === 'td';
    if (isItem && !inList) { out.push('<ul class="items">'); inList = true; }
    if (!isItem && inList) { out.push('</ul>'); inList = false; }

    if (isItem) out.push(`<li>${esc(b.text)}</li>`);
    else if (/^h[1-6]$/.test(b.tag)) out.push(`<h3>${esc(b.text)}</h3>`);
    else if (b.tag === 'blockquote') out.push(`<blockquote>${esc(b.text)}</blockquote>`);
    else if (b.tag === 'pre') out.push(`<pre>${esc(b.text)}</pre>`);
    else out.push(`<p>${esc(b.text)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

/* ── markdown ──────────────────────────────────────────────────────────── */

export function renderMarkdown(r) {
  const l = [];
  l.push(`# ${r.title}`, '');
  l.push(`*Read by readline from ${r.finalURL}*`, '');
  if (r.description) l.push(r.description, '');
  for (const note of r.notes) l.push(`> ${note}`, '');

  if (r.facts.length) {
    for (const f of r.facts) l.push(`- **${f.label}:** ${f.value}`);
    l.push('');
  }

  for (const s of r.sections) {
    l.push(`## ${s.title}`, '');
    s.items.forEach((it, i) => {
      const bullet = s.numbered ? `${i + 1}.` : '-';
      const meta = it.meta ? ` — ${it.meta}` : '';
      l.push(`${bullet} ${it.title}${meta}${it.href ? `  <${it.href}>` : ''}`);
    });
    l.push('');
  }

  if (r.blocks.length) {
    l.push('## Page text', '');
    for (const b of r.blocks) {
      if (/^h[1-6]$/.test(b.tag)) l.push(`### ${b.text}`, '');
      else if (b.tag === 'li' || b.tag === 'dd') l.push(`- ${b.text}`);
      else if (b.tag === 'blockquote') l.push(`> ${b.text}`, '');
      else if (b.tag === 'pre') l.push('```', b.text, '```', '');
      else l.push(b.text, '');
    }
    l.push('');
  }

  if (r.links.length) {
    l.push('## Links on the page', '');
    for (const link of r.links) l.push(`- [${link.text}](${link.href})`);
    l.push('');
  }

  l.push('---', `Original: ${r.finalURL}`, `Read ${r.fetchedAt}`);
  return l.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function renderText(r) {
  return renderMarkdown(r).replace(/^#+ /gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^> /gm, '');
}

/* ── the failure page ──────────────────────────────────────────────────── */

export function renderError(message, { target, origin, status = 502 }) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>readline — could not read that</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;700&display=swap">
<style>${CSS}</style></head><body><article>
<p class="from"><span class="mark"></span>readline</p>
<h1>Could not read that page.</h1>
<p class="desc">${esc(message)}</p>
${target ? `<dl class="facts"><dt>Link</dt><dd><a href="${esc(target)}">${esc(target)}</a></dd></dl>` : ''}
<footer><a href="${esc(origin)}/">Try another link</a></footer>
</article></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // The failure page echoes the address that failed, so it gets the same
      // "nothing may run here" policy as a successful read.
      'content-security-policy':
        "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
