import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridLanes, gridTimeline } from '../grid-layout.mjs';
test('short consecutive sessions share a lane while actual overlaps do not', () => {
  const a = { start: '2026-11-09T15:24:00Z', end: '2026-11-09T15:29:00Z' };
  const b = { start: '2026-11-09T15:29:00Z', end: '2026-11-09T15:34:00Z' };
  const c = { start: '2026-11-09T15:30:00Z', end: '2026-11-09T15:31:00Z' };
  const result = gridLanes([c, b, a]);
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.assigned.map(([, lane]) => lane),
    [0, 0, 1],
  );
});
test('dynamic timeline aligns events and row boundaries while compressing idle time', () => {
  const timeline = gridTimeline(0, 60, [
    { start: 1, end: 6 },
    { start: 8, end: 13 },
    { start: 15, end: 20 },
    { start: 4, end: 16 },
  ]);
  assert.equal(timeline.get(6) - timeline.get(1), 72);
  assert.equal(timeline.get(13) - timeline.get(8), 72);
  assert.equal(timeline.get(20) - timeline.get(15), 72);
  assert.equal(timeline.get(8) - timeline.get(6), 2);
  assert.equal(timeline.get(15) - timeline.get(13), 2);
  assert.equal(timeline.get(60) - timeline.get(30), 30);
  assert.ok(timeline.get(16) - timeline.get(4) >= 72);
});
test('events extending beyond the day end are clipped', () => {
  const timeline = gridTimeline(0, 60, [{ start: 59, end: 90 }]);
  assert.equal(timeline.get(60) - timeline.get(59), 72);
});

test('short breaks are visually filled only within the same lane', () => {
  const a = { start: '2026-11-09T10:15:00Z', end: '2026-11-09T10:20:00Z' };
  const overlap = {
    start: '2026-11-09T10:19:00Z',
    end: '2026-11-09T10:25:00Z',
  };
  const b = { start: '2026-11-09T10:22:00Z', end: '2026-11-09T10:27:00Z' };
  const c = { start: '2026-11-09T10:33:00Z', end: '2026-11-09T10:38:00Z' };
  const { assigned } = gridLanes([a, overlap, b, c]);
  assert.equal(assigned[0][2], b.start);
  assert.equal(assigned[1][2], overlap.end);
  assert.equal(assigned[2][2], b.end);
  assert.equal(a.end, '2026-11-09T10:20:00Z');
});
