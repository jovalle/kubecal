import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSpeakers } from '../speakers.mjs';

test('groups matching speaker records without merging unrelated namesakes', () => {
  const people = [
    { id: 'main:1', name: 'Alex', company: 'Example' },
    { id: 'colocated:1', name: 'Alex', company: '' },
    { id: 'colocated:2', name: 'Alex', company: ' example ' },
    { id: 'main:3', name: 'Alex', company: 'Other' },
  ];
  assert.deepEqual(
    groupSpeakers(people).map((group) => group.map((p) => p.id)),
    [['main:1', 'colocated:1', 'colocated:2'], ['main:3']],
  );
});
