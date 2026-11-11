import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/site-worker.mjs';
import data from '../data/sessions.json' with { type: 'json' };

test('serves site assets and denies remote PowerPoint conversion', async () => {
  const env = { ASSETS: { fetch: async () => new Response('site') } };
  assert.equal(
    await (await worker.fetch(new Request('https://example.com/'), env)).text(),
    'site',
  );
  const pptx = data.sessions
    .flatMap((s) => s.links)
    .find((l) => l.url.endsWith('.pptx')).url;
  const response = await worker.fetch(
    new Request(
      `https://example.com/api/slides?url=${encodeURIComponent(pptx)}`,
    ),
    env,
  );
  assert.equal(response.status, 404);
});
