import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFilters,
  matchesFilters,
  filterQuery,
  parseFilters,
} from '../filters.mjs';
const s = {
    start: '2026-11-09T23:00:00Z',
    end: '2026-11-10T01:00:00Z',
    room: 'A',
    tags: ['Talk', 'Beginner'],
    title: 'Kubernetes',
    description: '',
    speakers: '',
  },
  day = (x) => new Date(x).toISOString().slice(0, 10);
test('facets combine OR within and AND across, including overnight events', () => {
  let f = emptyFilters();
  f.date = ['2026-11-10'];
  f.type = ['Other', 'Talk'];
  f.venue = ['A'];
  assert.equal(matchesFilters(s, f, day), true);
  f.level = ['Advanced'];
  assert.equal(matchesFilters(s, f, day), false);
});
test('sharing preserves repeated filters and view', () => {
  let f = emptyFilters();
  f.venue = ['A', 'B'];
  f.search = 'cluster & tools';
  assert.deepEqual(parseFilters(filterQuery(f, 'grid')), {
    filters: f,
    view: 'grid',
  });
});
test('fuzzy search tolerates a typo and matches multiple terms', async () => {
  const { fuzzyMatch } = await import('../filters.mjs');
  assert.equal(
    fuzzyMatch('kubernets smith', 'Kubernetes by Alice Smith'),
    true,
  );
  assert.equal(
    fuzzyMatch('kubernets jones', 'Kubernetes by Alice Smith'),
    false,
  );
  assert.equal(fuzzyMatch('kub', 'Kubernetes'), true);
});

test('sponsor search and multi-select facets combine correctly', async () => {
  const { matchesSponsor } = await import('../filters.mjs');
  const sponsor = {
    name: 'Acme Security',
    level: 'Gold',
    booth: '277',
    categories: ['Security', 'Observability'],
  };
  assert.equal(
    matchesSponsor(sponsor, 'acm securty', ['Silver', 'Gold'], ['Security']),
    true,
  );
  assert.equal(matchesSponsor(sponsor, '277', [], []), true);
  assert.equal(matchesSponsor(sponsor, '', ['Silver'], ['Security']), false);
  assert.equal(matchesSponsor(sponsor, '', ['Gold'], ['Networking']), false);
});
