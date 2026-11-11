import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.mjs';
import data from '../data/sessions.json' with { type: 'json' };

const session = data.sessions.find((s) =>
  s.links.some(
    (l) => l.label.trim().toLowerCase() === 'slides' && l.url.endsWith('.pdf'),
  ),
);
const url = session.links.find(
  (l) => l.label.trim().toLowerCase() === 'slides' && l.url.endsWith('.pdf'),
).url;

test('streams only catalog slide previews and preserves range responses', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (target, options) => {
    assert.equal(target, url);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.get('range'), 'bytes=0-9');
    return new Response('%PDF-test', {
      status: 206,
      headers: { 'content-range': 'bytes 0-9/20' },
    });
  };
  const response = await worker.fetch(
    new Request(`https://proxy.example/?url=${encodeURIComponent(url)}`, {
      headers: { range: 'bytes=0-9', cookie: 'secret' },
    }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-range'), 'bytes 0-9/20');
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.equal(await response.text(), '%PDF-test');
});

test('rejects unknown URLs and upstream redirects', async (t) => {
  assert.equal(
    (
      await worker.fetch(
        new Request('https://proxy.example/?url=https://example.com/file.pdf'),
      )
    ).status,
    404,
  );
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/' },
    });
  assert.equal(
    (
      await worker.fetch(
        new Request(`https://proxy.example/?url=${encodeURIComponent(url)}`),
      )
    ).status,
    502,
  );
});

test('follows the Sessionize CDN redirect without forwarding cookies', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const cdn = url.replace(
    'https://sessionize.com/',
    'https://cdn.sessionize.com/',
  );
  let calls = 0;
  globalThis.fetch = async (target, options) => {
    assert.equal(options.headers.has('cookie'), false);
    if (calls++ === 0)
      return new Response(null, { status: 301, headers: { location: cdn } });
    assert.equal(target, cdn);
    return new Response('%PDF-test');
  };
  const response = await worker.fetch(
    new Request(`http://localhost/?url=${encodeURIComponent(url)}`, {
      headers: { cookie: 'private' },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '%PDF-test');
});

test('permits catalog PowerPoint files for local conversion', async (t) => {
  const powerpoint = data.sessions
    .flatMap((s) => s.links)
    .find(
      (link) =>
        link.label.trim().toLowerCase() === 'slides' &&
        link.url.endsWith('.pptx'),
    ).url;
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => new Response('deck');
  const response = await worker.fetch(
    new Request(`http://127.0.0.1/?url=${encodeURIComponent(powerpoint)}`),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /presentationml/);
});
