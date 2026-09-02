/* `assemble` is the half of extraction that decides what a page *is*, given
   the raw bits a walk of the document collected. It is pure, so it can be
   tested here without a Workers runtime; `scrape`, which needs HTMLRewriter,
   is covered by the live checks in TESTING.md. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../worker/src/extract.js';
import { normaliseLink, looksLikeLink, shareLink, summarise } from '../src/util.js';

const raw = (over = {}) => ({
  title: '', meta: {}, rel: {}, ld: [], blocks: [], links: [], images: [], truncated: false, ...over,
});

const target = 'https://music.apple.com/us/album/x/1';

test('metadata alone is enough to describe a page that has no text', () => {
  const r = assemble(raw({
    title: '1989 by Taylor Swift on Apple Music',
    meta: {
      'og:title': "1989 (Taylor's Version) by Taylor Swift on Apple Music",
      'og:description': 'Album · 2023 · 21 Songs',
      'og:site_name': 'Apple Music - Web Player',
      'og:image': 'https://example.com/cover.jpg',
      'og:type': 'music.album',
    },
  }), { target, finalURL: target, mime: 'text/html' });

  assert.match(r.title, /^1989/);
  assert.equal(r.image, 'https://example.com/cover.jpg');
  assert.equal(r.facts.find((f) => f.label === 'Summary').value, 'Album · 2023 · 21 Songs');
  assert.equal(r.site, 'music.apple.com');
  assert.ok(r.notes.some((n) => /no readable text/.test(n)));
});

test('the site name is trimmed off the end of a title', () => {
  const r = assemble(raw({
    title: 'How to make soup | Serious Cooking',
    meta: { 'og:site_name': 'Serious Cooking' },
  }), { target: 'https://example.com/soup', finalURL: 'https://example.com/soup', mime: 'text/html' });
  assert.equal(r.title, 'How to make soup');
});

test('structured data outranks Open Graph when the two disagree', () => {
  const r = assemble(raw({
    meta: { 'og:title': 'Generic share title' },
    ld: [JSON.stringify({ '@type': 'Article', name: 'The real headline', author: { name: 'A. Writer' } })],
  }), { target: 'https://example.com/a', finalURL: 'https://example.com/a', mime: 'text/html' });

  assert.equal(r.title, 'The real headline');
  assert.equal(r.facts.find((f) => f.label === 'By').value, 'A. Writer');
});

test('the headline is not repeated as the first line of the body', () => {
  const r = assemble(raw({
    title: 'A Headline',
    blocks: [{ tag: 'h1', text: 'A Headline' }, { tag: 'p', text: 'The first paragraph, which is long enough to count.' }],
  }), { target: 'https://example.com/a', finalURL: 'https://example.com/a', mime: 'text/html' });

  assert.equal(r.blocks.length, 1);
  assert.match(r.blocks[0].text, /^The first paragraph/);
});

test('cookie and app nags are dropped', () => {
  const r = assemble(raw({
    blocks: [
      { tag: 'p', text: 'We use cookies to improve your experience.' },
      { tag: 'p', text: 'Open in app for a better experience' },
      { tag: 'p', text: 'Actual content lives here.' },
    ],
  }), { target: 'https://example.com/a', finalURL: 'https://example.com/a', mime: 'text/html' });

  assert.deepEqual(r.blocks.map((b) => b.text), ['Actual content lives here.']);
});

test('links are deduplicated and off-site ones come first', () => {
  const r = assemble(raw({
    links: [
      { href: 'https://example.com/self', text: 'Home' },
      { href: 'https://other.example/a', text: 'Elsewhere' },
      { href: 'https://example.com/self', text: 'Home again' },
      { href: 'https://example.com/x', text: 'a' },   // too short to be a label
    ],
  }), { target: 'https://example.com/a', finalURL: 'https://example.com/a', mime: 'text/html' });

  assert.deepEqual(r.links.map((l) => l.text), ['Elsewhere', 'Home']);
});

test('a truncated read says so rather than pretending to be complete', () => {
  const r = assemble(raw({ truncated: true, blocks: [{ tag: 'p', text: 'Some text here.' }] }),
    { target: 'https://example.com/a', finalURL: 'https://example.com/a', mime: 'text/html' });
  assert.ok(r.notes.some((n) => /first part/.test(n)));
});

/* ── the front page's own helpers ── */

test('anything a person might paste normalises to a URL', () => {
  assert.equal(normaliseLink('music.apple.com/us/album/x'), 'https://music.apple.com/us/album/x');
  assert.equal(normaliseLink('  https://example.com/a  '), 'https://example.com/a');
  assert.equal(normaliseLink('check this out: https://example.com/a'), 'https://example.com/a');
  assert.equal(normaliseLink('<https://example.com/a>'), 'https://example.com/a');
  assert.equal(normaliseLink(''), '');
});

test('things that are not web links are rejected', () => {
  assert.equal(looksLikeLink('hello there'), false);
  assert.equal(looksLikeLink('mailto:someone@example.com'), false);
  assert.equal(looksLikeLink('localhost'), false);
  assert.equal(looksLikeLink('example.com'), true);
});

test('the page builds the same share link the worker would parse', () => {
  assert.equal(
    shareLink('https://r.example/', 'https://x.example/a?b=c'),
    'https://r.example/r/https://x.example/a?b=c',
  );
});

test('the summary line counts what actually came back, not what was sent', () => {
  const reading = {
    sections: [{ title: 'Tracks', unit: 'track', items: new Array(21).fill({ title: 't' }) }],
    stats: { words: 1096, links: 43 },
    facts: [{ label: 'By', value: 'X' }],
    links: [{}, {}], // the API trims the array; the count must not follow it
  };
  assert.equal(summarise(reading), 'Extracted 21 tracks · 1,096 words · 1 fact · 43 links');
});

test('each section is counted in its own unit', () => {
  const reading = {
    sections: [
      { title: 'Ingredients', unit: 'ingredient', items: new Array(6).fill({}) },
      { title: 'Method', unit: 'step', items: new Array(5).fill({}) },
    ],
    stats: { words: 693, links: 22 },
    facts: [],
    links: [],
  };
  assert.equal(summarise(reading), 'Extracted 6 ingredients · 5 steps · 693 words · 22 links');
});

test('a page with nothing on it says so rather than showing an empty line', () => {
  assert.equal(
    summarise({ sections: [], stats: { words: 0, links: 0 }, facts: [], links: [] }),
    'Extracted the page metadata only',
  );
});
