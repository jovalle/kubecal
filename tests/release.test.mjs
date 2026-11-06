import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateNotes } from '@semantic-release/release-notes-generator';

test('configured changelog preset generates release notes', async () => {
  const config = JSON.parse(await readFile('.releaserc.json', 'utf8'));
  const [, options] = config.plugins.find(
    (plugin) => plugin[0] === '@semantic-release/release-notes-generator',
  );
  const notes = await generateNotes(options, {
    cwd: process.cwd(),
    commits: [{ message: 'feat: build KubeCon scheduler', hash: '1234567890' }],
    lastRelease: {},
    nextRelease: { version: '1.0.0', gitTag: 'v1.0.0', gitHead: '1234567890' },
    options: { repositoryUrl: 'https://github.com/jovalle/kubecal' },
  });
  assert.match(notes, /build KubeCon scheduler/);
});
