/* HTMLRewriter hands text back with its entities intact, so every string that
   reaches a reader page goes through this first. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities } from '../worker/src/extract.js';

test('the named entities that actually turn up in page text', () => {
  assert.equal(decodeEntities('Policy &amp; Safety'), 'Policy & Safety');
  assert.equal(decodeEntities('&copy; 2026 Google LLC'), '© 2026 Google LLC');
  assert.equal(decodeEntities('it&rsquo;s a &ldquo;quote&rdquo;'), 'it’s a “quote”');
  assert.equal(decodeEntities('caf&eacute; &mdash; open'), 'café — open');
  assert.equal(decodeEntities('a&nbsp;b'), 'a b');
});

test('numeric entities, decimal and hex', () => {
  assert.equal(decodeEntities('&#8217;'), '’');
  assert.equal(decodeEntities('&#x2014;'), '—');
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
});

test('one pass, so a double-escaped entity is not decoded twice', () => {
  // If &amp; were replaced first and the result scanned again, this would
  // become a real tag and the escaping in the source page would be undone.
  assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
});

test('nonsense is left exactly as it was', () => {
  assert.equal(decodeEntities('a & b'), 'a & b');
  assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
  assert.equal(decodeEntities('50% off &#x0;'), '50% off &#x0;');
  assert.equal(decodeEntities('&#xD800;'), '&#xD800;'); // a lone surrogate would throw
  assert.equal(decodeEntities('AT&T'), 'AT&T');
});
