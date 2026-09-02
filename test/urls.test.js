/* The guard is the whole security story of a worker that fetches whatever a
   stranger names, so it gets the most tests. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTarget, ipv4ToInt, parseReaderURL, readerLink, BadTarget } from '../worker/src/urls.js';

const blocked = (u) => assert.throws(() => checkTarget(u), BadTarget, `should have blocked ${u}`);
const allowed = (u) => assert.ok(checkTarget(u), `should have allowed ${u}`);

test('ordinary public links pass', () => {
  allowed('https://music.apple.com/us/album/1989-taylors-version/1708308989');
  allowed('http://example.com');
  allowed('https://example.com:8443/a/b?c=d#e');
  allowed('https://8.8.8.8/');
});

test('schemes other than http(s) are refused', () => {
  blocked('file:///etc/passwd');
  blocked('ftp://example.com/x');
  blocked('javascript:alert(1)');
  blocked('data:text/html,<h1>hi');
});

test('loopback and private addresses are refused, however they are spelled', () => {
  for (const host of [
    '127.0.0.1', 'localhost', '0.0.0.0', '10.0.0.1', '192.168.1.1', '172.16.0.1',
    '169.254.169.254',           // the cloud metadata address
    '2130706433',                // 127.0.0.1 as one integer
    '0x7f000001',                // …as hex
    '017700000001',              // …as octal
    '127.1',                     // …with the octets folded
    '[::1]', '[::ffff:127.0.0.1]', '[fd00::1]', '[fe80::1]',
  ]) {
    blocked(`http://${host}/`);
  }
});

test('internal-sounding names are refused', () => {
  blocked('http://intranet/');
  blocked('http://db.internal/');
  blocked('http://printer.local/');
  blocked('http://metadata.google.internal/');
});

test('credentials in a URL are refused — they only ever disguise the host', () => {
  blocked('https://music.apple.com@evil.example/');
  blocked('https://user:pw@example.com/');
});

test('ipv4ToInt collapses every spelling of an address', () => {
  assert.equal(ipv4ToInt('127.0.0.1'), 2130706433);
  assert.equal(ipv4ToInt('2130706433'), 2130706433);
  assert.equal(ipv4ToInt('127.1'), 2130706433);
  assert.equal(ipv4ToInt('0x7f.0.0.1'), 2130706433);
  assert.equal(ipv4ToInt('example.com'), null);
  assert.equal(ipv4ToInt('999.1.1.1'), null);
});

test('a reader link keeps the target legible and gets it back intact', () => {
  const target = 'https://music.apple.com/us/album/1989-taylors-version/1708308989';
  const link = readerLink('https://readline.example.workers.dev', target);
  assert.equal(link, `https://readline.example.workers.dev/r/${target}`);
  assert.equal(parseReaderURL(link).target, target);
});

test('a target that has its own query string survives the round trip', () => {
  const target = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42';
  const link = readerLink('https://r.example', target);
  const parsed = parseReaderURL(link);
  assert.equal(parsed.target, target);
  assert.equal(parsed.format, 'html');
});

test('our own options are namespaced so they cannot be mistaken for the target’s', () => {
  const parsed = parseReaderURL('https://r.example/r/https://site.example/x?format=csv&__format=md');
  assert.equal(parsed.target, 'https://site.example/x?format=csv');
  assert.equal(parsed.format, 'md');
});

test('the explicit ?u= form works and takes a plain format param', () => {
  const parsed = parseReaderURL('https://r.example/r?u=' + encodeURIComponent('https://x.example/a?b=c') + '&format=json');
  assert.equal(parsed.target, 'https://x.example/a?b=c');
  assert.equal(parsed.format, 'json');
});

test('a percent-encoded target in the path decodes', () => {
  const target = 'https://x.example/a b';
  const parsed = parseReaderURL(`https://r.example/r/${encodeURIComponent(target)}`);
  assert.equal(parsed.target, target);
});

test('a bare host in a reader link is assumed to be https', () => {
  assert.equal(parseReaderURL('https://r.example/r/example.com/x').target, 'https://example.com/x');
});

test('an unknown format falls back to html rather than erroring', () => {
  assert.equal(parseReaderURL('https://r.example/r/https://x.example?__format=exe').format, 'html');
});
