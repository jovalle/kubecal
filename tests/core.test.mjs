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

test('versioned recovery dictionaries restore old codes and include newly added sessions', () => {
  const oldDictionary = ['a', 'b', 'c'];
  const newDictionary = ['a', 'b', 'c', 'new-session'];
  const oldState = {
    selected: ['a', 'c'],
    timezone: 'America/Denver',
    view: 'grid',
  };
  const oldCode = encodeState(oldState, oldDictionary);
  const newState = { ...oldState, selected: ['a', 'new-session'] };
  const newCode = encodeState(newState, newDictionary, 2);
  assert.match(newCode, /^KC2\./);
  assert.deepEqual(decodeState(newCode, newDictionary, 2), newState);
  assert.deepEqual(decodeState(oldCode, oldDictionary), oldState);
  assert.throws(() => decodeState(newCode, oldDictionary));
  assert.throws(() => decodeState(oldCode, newDictionary, 2));
});

test('finds only slide links on a session', async () => {
  const { slideLinks } = await import('../core.mjs');
  assert.deepEqual(
    slideLinks({
      links: [
        { label: 'Website', url: 'https://example.com' },
        { label: ' Slides ', url: 'https://example.com/deck.pdf' },
      ],
    }),
    [{ label: ' Slides ', url: 'https://example.com/deck.pdf' }],
  );
  assert.deepEqual(slideLinks({ links: [] }), []);
});

test('slide previews use only mapped PDF or image assets', async () => {
  const { slidePreview } = await import('../core.mjs');
  const url = 'https://sessionize.com/download/example~deck.pdf';
  assert.deepEqual(slidePreview(url, { [url]: 'abc123-slides.pdf' }), {
    src: './slides/2026/abc123-slides.pdf',
    type: 'pdf',
  });
  assert.deepEqual(
    slidePreview('https://example.com/image.jpg', {
      'https://example.com/image.jpg': 'abc123-image.jpg',
    }),
    { src: './slides/2026/abc123-image.jpg', type: 'image' },
  );
  assert.equal(slidePreview(url, {}), null);
  assert.equal(slidePreview(url, { [url]: '../other.pdf' }), null);
  assert.equal(slidePreview(url, { [url]: 'abc123.pptx' }), null);
  assert.equal(
    slidePreview('javascript:alert(1)', {
      'javascript:alert(1)': 'abc123-slides.pdf',
    }),
    null,
  );
});

test('uses the configured proxy for supported Sessionize previews', async () => {
  const { slidePreview } = await import('../core.mjs');
  const source = 'https://sessionize.com/download/example~deck.pdf';
  assert.deepEqual(slidePreview(source, {}, 'https://preview.example/'), {
    src: `https://preview.example/?${new URLSearchParams({ url: source })}`,
    type: 'pdf',
  });
  assert.equal(
    slidePreview(
      'https://example.com/deck.pdf',
      {},
      'https://preview.example/',
    ),
    null,
  );
});

test('permits a loopback proxy for local previews', async () => {
  const { slidePreview } = await import('../core.mjs');
  const url = 'https://sessionize.com/download/example~deck.pdf';
  assert.equal(slidePreview(url, {}, 'http://127.0.0.1:5466/').type, 'pdf');
  assert.equal(slidePreview(url, {}, 'http://example.com/'), null);
});

test('finds the current or next session and handles times outside the schedule', async () => {
  const { sessionAtNow } = await import('../core.mjs');
  const sessions = [
    {
      id: 'morning',
      start: '2026-11-10T09:00:00Z',
      end: '2026-11-10T10:00:00Z',
    },
    { id: 'late', start: '2026-11-10T11:00:00Z', end: '2026-11-10T12:00:00Z' },
  ];
  assert.equal(
    sessionAtNow(sessions, Date.parse('2026-11-10T08:00:00Z')).id,
    'morning',
  );
  assert.equal(
    sessionAtNow(sessions, Date.parse('2026-11-10T09:30:00Z')).id,
    'morning',
  );
  assert.equal(
    sessionAtNow(sessions, Date.parse('2026-11-10T10:30:00Z')).id,
    'late',
  );
  assert.equal(
    sessionAtNow(sessions, Date.parse('2026-11-10T13:00:00Z')).id,
    'late',
  );
  assert.equal(sessionAtNow([], Date.now()), null);
});

test('offers PowerPoint previews through the local proxy', async () => {
  const { slidePreview } = await import('../core.mjs');
  const source = 'https://sessionize.com/download/example~deck.pptx';
  assert.equal(slidePreview(source, {}, 'http://127.0.0.1:5466/').type, 'pdf');
  assert.equal(slidePreview(source, {}, 'https://preview.example/'), null);
});

test('converted slides report proxy errors and reject non-PDF responses', async (t) => {
  const { loadConvertedSlide } = await import('../core.mjs');
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => new Response('failed', { status: 502 });
  await assert.rejects(loadConvertedSlide('http://127.0.0.1:5466/'));
  globalThis.fetch = async () =>
    new Response('not a PDF', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(loadConvertedSlide('http://127.0.0.1:5466/'));
  globalThis.fetch = async () =>
    new Response('%PDF-test', {
      headers: { 'content-type': 'application/pdf' },
    });
  assert.equal(
    (await loadConvertedSlide('http://127.0.0.1:5466/')).type,
    'application/pdf',
  );
});

test('schedule selection keeps the preset separate from personal selections', async () => {
  const { inSchedule } = await import('../core.mjs');
  assert.equal(inSchedule('all', 'a', ['a'], ['b']), true);
  assert.equal(inSchedule('mine', 'a', ['a'], ['b']), true);
  assert.equal(inSchedule('mine', 'b', ['a'], ['b']), false);
  assert.equal(inSchedule('jay', 'a', ['a'], ['b']), false);
  assert.equal(inSchedule('jay', 'b', ['a'], ['b']), true);
  assert.equal(inSchedule('jay', 'a', ['a'], ['b'], true), true);
  assert.equal(inSchedule('mine', 'b', ['a'], ['b'], true), false);
});

test('toggling a session adds or removes it without changing the original list', async () => {
  const { toggleSession } = await import('../core.mjs');
  const original = ['a'];
  assert.deepEqual(toggleSession(original, 'b'), ['a', 'b']);
  assert.deepEqual(toggleSession(original, 'a'), []);
  assert.deepEqual(original, ['a']);
});

test('plan overrides preserve additions and removals when the preset changes', async () => {
  const { planDiff, applyPlanDiff } = await import('../core.mjs');
  const diff = planDiff(['a', 'b'], ['b', 'custom']);
  assert.deepEqual(diff, { added: ['custom'], removed: ['a'] });
  assert.deepEqual(applyPlanDiff(['a', 'b', 'new'], diff), [
    'b',
    'new',
    'custom',
  ]);
  assert.deepEqual(planDiff(['a', 'b'], ['a', 'b']), {
    added: [],
    removed: [],
  });
});
