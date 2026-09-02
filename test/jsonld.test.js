/* The structured-data path is what makes an Apple Music link work at all, so
   the album case below is a cut-down copy of what that page really serves. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, pickPrimary, shape, duration, span, stripTags, typeOf } from '../worker/src/jsonld.js';

const ALBUM = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'MusicAlbum',
  name: "1989 (Taylor's Version)",
  description: 'Listen to the album.',
  genre: ['Pop'],
  datePublished: '2023-10-27',
  byArtist: { '@type': 'MusicGroup', name: 'Taylor Swift', url: 'https://music.apple.com/us/artist/taylor-swift/159260351' },
  tracks: [
    { '@type': 'MusicRecording', name: "Welcome To New York (Taylor's Version)", duration: 'PT3M32S', url: 'https://music.apple.com/us/song/x/1708308990' },
    { '@type': 'MusicRecording', name: "Blank Space (Taylor's Version)", duration: 'PT3M51S', url: 'https://music.apple.com/us/song/y/1708308993' },
  ],
});

test('an album yields its artist, its date and every track', () => {
  const r = shape(parseBlocks([ALBUM]));
  assert.equal(r.kind, 'MusicAlbum');
  assert.equal(r.name, "1989 (Taylor's Version)");

  const by = r.facts.find((f) => f.label === 'By');
  assert.equal(by.value, 'Taylor Swift');
  assert.match(by.href, /artist\/taylor-swift/);
  assert.equal(r.facts.find((f) => f.label === 'Published').value, '2023-10-27');

  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].title, 'Tracks');
  assert.equal(r.sections[0].numbered, true);
  assert.equal(r.sections[0].items.length, 2);
  assert.equal(r.sections[0].items[0].title, "Welcome To New York (Taylor's Version)");
  assert.equal(r.sections[0].items[0].meta, '3:32');
  assert.match(r.sections[0].items[0].href, /1708308990/);
});

test('@graph and nested arrays flatten to the same list', () => {
  const nodes = parseBlocks([
    JSON.stringify({ '@graph': [{ '@type': 'WebSite', name: 'S' }, { '@type': 'Article', headline: 'H' }] }),
    JSON.stringify([{ '@type': 'BreadcrumbList' }]),
  ]);
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map(typeOf).sort(), ['Article', 'BreadcrumbList', 'WebSite']);
});

test('the interesting entity wins over the boilerplate ones', () => {
  const nodes = parseBlocks([JSON.stringify([
    { '@type': 'WebSite', name: 'Site' },
    { '@type': 'BreadcrumbList' },
    { '@type': 'Recipe', name: 'Soup' },
  ])]);
  assert.equal(typeOf(pickPrimary(nodes)), 'Recipe');
});

test('a malformed block is skipped rather than failing the whole read', () => {
  const nodes = parseBlocks(['{not json', ALBUM]);
  assert.equal(nodes.length, 1);
});

test('a recipe gives ingredients and a flattened method', () => {
  const r = shape(parseBlocks([JSON.stringify({
    '@type': 'Recipe',
    name: 'Soup',
    recipeYield: '4 servings',
    prepTime: 'PT15M',
    recipeIngredient: ['2 onions', '1 l stock'],
    recipeInstructions: [
      { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Chop the onions.' }] },
      { '@type': 'HowToStep', text: '<p>Simmer for an hour.</p>' },
    ],
  })]));

  assert.equal(r.facts.find((f) => f.label === 'Yield').value, '4 servings');
  assert.equal(r.facts.find((f) => f.label === 'Prep').value, '15 min');
  const [ing, method] = r.sections;
  assert.deepEqual(ing.items.map((i) => i.title), ['2 onions', '1 l stock']);
  assert.deepEqual(method.items.map((i) => i.title), ['Chop the onions.', 'Simmer for an hour.']);
});

test('a product carries its price and rating', () => {
  const r = shape(parseBlocks([JSON.stringify({
    '@type': 'Product',
    name: 'Thing',
    offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' },
    aggregateRating: { ratingValue: 4.4, bestRating: 5, ratingCount: 812 },
  })]));
  assert.equal(r.facts.find((f) => f.label === 'Price').value, '19.99 GBP');
  assert.equal(r.facts.find((f) => f.label === 'Availability').value, 'InStock');
  assert.equal(r.facts.find((f) => f.label === 'Rating').value, '4.4 / 5 (812 ratings)');
});

test('ISO durations become times a person can read', () => {
  assert.equal(duration('PT3M32S'), '3:32');
  assert.equal(duration('PT1H4M30S'), '1:04:30');
  assert.equal(duration('PT45S'), '0:45');
  assert.equal(duration('PT0S'), '');
  assert.equal(duration('nonsense'), '');
  assert.equal(duration(undefined), '');
});

test('a length reads as a clock, a duration of effort reads as words', () => {
  assert.equal(span('PT10M'), '10 min');
  assert.equal(span('PT1H30M'), '1 hr 30 min');
  assert.equal(span('PT45S'), '45 sec');
  assert.equal(span('P1DT2H'), '1 day 2 hr');
  assert.equal(span('PT1H0M0S'), '1 hr');
  assert.equal(span(''), '');
});

test('markup inside description fields is removed', () => {
  assert.equal(stripTags('<p>Hello&nbsp; <b>there</b></p>'), 'Hello there');
});

test('a page with no structured data at all shapes to nothing, not a crash', () => {
  const r = shape([]);
  assert.deepEqual(r, { kind: '', facts: [], sections: [] });
});
