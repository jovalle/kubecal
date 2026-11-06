export function gridTimeline(start, end, events) {
  const intervals = events
    .map(({ start: from, end: to }) => ({
      start: Math.max(start, from),
      end: Math.min(end, to),
    }))
    .filter((e) => e.end > e.start);
  const points = [
    ...new Set([
      start,
      end,
      ...intervals.flatMap((e) => [e.start, e.end]),
      ...Array.from(
        { length: Math.floor((end - start) / 15) + 1 },
        (_, i) => start + i * 15,
      ),
    ]),
  ].sort((a, b) => a - b);
  const heights = points.slice(1).map((point, i) => point - points[i]);
  for (const event of intervals.sort(
    (a, b) => a.end - a.start - (b.end - b.start),
  )) {
    const first = points.indexOf(event.start),
      last = points.indexOf(event.end);
    const current = heights
      .slice(first, last)
      .reduce((sum, height) => sum + height, 0);
    const extra = Math.max(0, 72 - current);
    for (let i = first; i < last; i++)
      heights[i] +=
        (extra * (points[i + 1] - points[i])) / (event.end - event.start);
  }
  const positions = new Map([[start, 0]]);
  for (let i = 0; i < heights.length; i++)
    positions.set(points[i + 1], positions.get(points[i]) + heights[i]);
  return positions;
}
export function gridLanes(items) {
  const ends = [],
    assigned = [],
    last = [];
  for (const session of [...items].sort((a, b) =>
    a.start.localeCompare(b.start),
  )) {
    const start = Date.parse(session.start);
    let lane = ends.findIndex((end) => end <= start);
    if (lane < 0) lane = ends.length;
    if (last[lane] && start - ends[lane] <= 5 * 60 * 1000)
      last[lane][2] = session.start;
    ends[lane] = Date.parse(session.end);
    const entry = [session, lane, session.end];
    assigned.push(entry);
    last[lane] = entry;
  }
  return { assigned, count: ends.length };
}
