import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState, overlaps, calendar } from '../core.mjs';
const dictionary = ['a', 'b', 'c'];
test('recovery code round trips selections and preferences and detects corruption', () => {
  const state = {
    selected: ['a', 'c'],
    timezone: 'America/Denver',
    view: 'grid',
  };
  const code = encodeState(state, dictionary);
  assert.deepEqual(decodeState(code, dictionary), state);
  assert.throws(() =>
    decodeState(
      code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A'),
      dictionary,
    ),
  );
});
test('back-to-back sessions do not overlap', () => {
  assert.equal(
    overlaps(
      { start: '2026-11-10T09:00:00-07:00', end: '2026-11-10T10:00:00-07:00' },
      { start: '2026-11-10T10:00:00-07:00', end: '2026-11-10T11:00:00-07:00' },
    ),
    false,
  );
});
test('calendar escapes text and uses UTC', () => {
  const result = calendar([
    {
      id: 'a',
      title: 'Hello, world',
      start: '2026-11-10T09:00:00-07:00',
      end: '2026-11-10T10:00:00-07:00',
      room: 'A;B',
      description: 'one\ntwo',
    },
  ]);
  assert.match(result, /DTSTART:20261110T160000Z/);
  assert.match(result, /SUMMARY:Hello\\, world/);
  assert.match(result, /LOCATION:A\\;B/);
});
test('empty and dense schedules restore without losing selections', () => {
  for (const selected of [[], dictionary]) {
    const original = { selected, timezone: 'UTC', view: 'venue' };
    assert.deepEqual(
      decodeState(encodeState(original, dictionary), dictionary),
      original,
    );
  }
});
test('snapshot links contain recoverable immutable codes', async () => {
  const { recoveryCode } = await import('../core.mjs');
  const original = { selected: ['a'], timezone: 'UTC', view: 'simple' };
  const id = encodeState(original, dictionary);
  assert.match(id, /^[A-Za-z0-9._-]+$/);
  assert.deepEqual(
    decodeState(
      recoveryCode(`https://example.com/project/#/snapshot/${id}`),
      dictionary,
    ),
    original,
  );
  assert.equal(recoveryCode(id), id);
  assert.throws(() => recoveryCode('https://example.com/#/session/abc'));
});
