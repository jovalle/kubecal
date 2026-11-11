import { slideLinks } from './core.mjs';

function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
export function fuzzyMatch(query, text) {
  const q = query.toLocaleLowerCase().trim();
  if (!q) return true;
  const value = text.toLocaleLowerCase();
  if (value.includes(q)) return true;
  const words = value.match(/[\p{L}\p{N}]+/gu) || [];
  return q
    .split(/\s+/)
    .every(
      (part) =>
        value.includes(part) ||
        (part.length >= 4 && words.some((word) => oneEdit(part, word))),
    );
}
export function matchesSponsor(s, query, levels, categories) {
  return (
    (!levels.length || levels.includes(s.level)) &&
    (!categories.length ||
      categories.some((category) => s.categories.includes(category))) &&
    fuzzyMatch(query, [s.name, s.level, s.booth, ...s.categories].join(' '))
  );
}
export const emptyFilters = () => ({
  search: '',
  date: [],
  venue: [],
  type: [],
  level: [],
  slides: false,
});
export function matchesFilters(s, f, day) {
  const q = f.search.trim().toLocaleLowerCase();
  return (
    (!f.slides || slideLinks(s).length > 0) &&
    (!f.date.length ||
      f.date.some(
        (d) => day(s.start) <= d && day(new Date(Date.parse(s.end) - 1)) >= d,
      )) &&
    (!f.venue.length || f.venue.includes(s.room)) &&
    (!f.type.length || f.type.some((t) => s.tags.includes(t))) &&
    (!f.level.length || f.level.some((t) => s.tags.includes(t))) &&
    (!q ||
      fuzzyMatch(q, [s.title, s.room, s.speakers, ...s.tags].join(' ')) ||
      s.description.toLocaleLowerCase().includes(q))
  );
}
export function filterQuery(f, view) {
  const p = new URLSearchParams();
  if (f.search) p.set('q', f.search);
  if (f.slides) p.set('slides', '1');
  for (const name of ['date', 'venue', 'type', 'level'])
    for (const v of f[name]) p.append(name, v);
  if (view !== 'simple') p.set('view', view);
  return p.toString();
}
export function parseFilters(query) {
  const p = new URLSearchParams(query),
    f = emptyFilters();
  f.search = p.get('q') || '';
  f.slides = p.get('slides') === '1';
  for (const name of ['date', 'venue', 'type', 'level'])
    f[name] = p.getAll(name);
  return { filters: f, view: p.get('view') };
}
