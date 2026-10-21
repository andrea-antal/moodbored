import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeta, isPublicHost } from '../lib/unfurl.mjs';

test('reads Open Graph tags and resolves a relative image', () => {
  const html = `<html><head><title>Fallback</title>
    <meta property="og:title" content="Linen &amp; Oak">
    <meta content="Warm rooms" name="description">
    <meta property='og:image' content='/img/hero.jpg'>
  </head><body></body></html>`;
  assert.deepEqual(parseMeta(html, 'https://www.studio.example/p/1'), {
    title: 'Linen & Oak',
    description: 'Warm rooms',
    image: 'https://www.studio.example/img/hero.jpg',
    site: 'studio.example',
  });
});

test('falls back to <title>, then the hostname', () => {
  assert.equal(parseMeta('<title>Just a title</title>', 'https://a.example').title, 'Just a title');
  assert.equal(parseMeta('', 'https://www.b.example/x').title, 'b.example');
});

test('refuses internal hosts', () => {
  for (const h of ['localhost', '127.0.0.1', '10.0.0.4', '192.168.1.20', '172.20.0.1', '169.254.169.254', '[::1]', 'printer.local']) {
    assert.equal(isPublicHost(h), false, h);
  }
  for (const h of ['pinterest.com', '8.8.8.8', 'fcbarcelona.com', '172.32.0.1']) assert.equal(isPublicHost(h), true, h);
});
