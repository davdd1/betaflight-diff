'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encode, decode } = require('./share.js');

test('hash round-trips both dumps', async () => {
  const a = '# Betaflight / STM32F405 4.4.2\nset p_pitch = 48\nprofile 1\nset d_pitch = 38\n';
  const b = 'feature GPS\nset name = åäö 🚁\r\nsave';
  const h = await encode(a, b);
  assert.match(h, /^z=[A-Za-z0-9_-]+$/);
  assert.deepStrictEqual(await decode('#' + h), { a, b });
});

test('empty sides round-trip', async () => {
  assert.deepStrictEqual(await decode(await encode('', '')), { a: '', b: '' });
});

test('a big dump compresses well and still round-trips', async () => {
  const big = Array.from({ length: 4000 }, (_, i) => 'set key_' + i + ' = ' + (i % 90)).join('\n');
  const h = await encode(big, big + '\nset extra = 1');
  assert.ok(h.length < big.length / 2, 'hash ' + h.length + ' vs raw ' + big.length);
  const d = await decode(h);
  assert.strictEqual(d.a, big);
  assert.strictEqual(d.b, big + '\nset extra = 1');
});

test('garbage, wrong shape and missing hashes decode to null', async () => {
  assert.strictEqual(await decode(''), null);
  assert.strictEqual(await decode('#'), null);
  assert.strictEqual(await decode('#z=!!!notbase64'), null);
  assert.strictEqual(await decode('#z=AAAA'), null);
  assert.strictEqual(await decode('#other=1'), null);
  assert.strictEqual(await decode('#p=' + encodeURIComponent('{"a":1}')), null);
  assert.strictEqual(await decode('#p=' + encodeURIComponent('[1,2]')), null);
});

test('plain fallback format decodes', async () => {
  const json = JSON.stringify(['set a = 1', 'set a = 2']);
  assert.deepStrictEqual(await decode('#p=' + encodeURIComponent(json)), { a: 'set a = 1', b: 'set a = 2' });
});
