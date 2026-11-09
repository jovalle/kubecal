const checksum = (s) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
};
const base64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const unbase64 = (s) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
export function encodeState(state, dictionary, version = 1) {
  const bits = new Uint8Array(Math.ceil(dictionary.length / 8)),
    chosen = new Set(state.selected);
  for (const id of chosen)
    if (!dictionary.includes(id))
      throw new Error(
        'A saved session is not in this recovery dictionary. Export a file instead.',
      );
  dictionary.forEach((id, i) => {
    if (chosen.has(id)) bits[i >> 3] |= 1 << (i % 8);
  });
  const indices = dictionary
    .map((id, i) => (chosen.has(id) ? i : -1))
    .filter((i) => i >= 0);
  const sparse = [];
  for (let n of indices) {
    do {
      let b = n & 127;
      n >>>= 7;
      sparse.push(b | (n ? 128 : 0));
    } while (n);
  }
  const compact = base64(new Uint8Array(sparse));
  const dense = base64(bits);
  const encoded = compact.length < dense.length ? 's' + compact : 'b' + dense;
  const prefs = base64(
    new TextEncoder().encode(JSON.stringify([state.timezone, state.view])),
  );
  const body = `KC${version}.${encoded}.${prefs}`;
  return `${body}.${checksum(body)}`;
}
export function decodeState(code, dictionary, version = 1) {
  const parts = code.trim().split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== `KC${version}` ||
    !/^[sb][A-Za-z0-9_-]*$/.test(parts[1]) ||
    checksum(parts.slice(0, 3).join('.')) !== parts[3]
  )
    throw new Error('Invalid or damaged recovery code.');
  let bits, prefs;
  try {
    let bytes = unbase64(parts[1].slice(1));
    bits = new Uint8Array(Math.ceil(dictionary.length / 8));
    if (parts[1][0] === 'b') {
      if (bytes.length !== bits.length) throw Error();
      bits = bytes;
    } else {
      let value = 0,
        shift = 0;
      for (const b of bytes) {
        value |= (b & 127) << shift;
        if (b & 128) {
          shift += 7;
          if (shift > 21) throw Error();
        } else {
          if (
            value >= dictionary.length ||
            bits[value >> 3] & (1 << (value % 8))
          )
            throw Error();
          bits[value >> 3] |= 1 << (value % 8);
          value = 0;
          shift = 0;
        }
      }
      if (shift) throw Error();
    }
    prefs = JSON.parse(new TextDecoder().decode(unbase64(parts[2])));
  } catch {
    throw new Error('Invalid recovery code.');
  }
  if (
    bits.length !== Math.ceil(dictionary.length / 8) ||
    !Array.isArray(prefs) ||
    prefs.length !== 2 ||
    typeof prefs[0] !== 'string' ||
    !['simple', 'expanded', 'grid', 'venue'].includes(prefs[1])
  )
    throw new Error('Unsupported recovery code.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: prefs[0] });
  } catch {
    throw new Error('Invalid timezone in recovery code.');
  }
  if (dictionary.length % 8 && bits.at(-1) >> (dictionary.length % 8))
    throw new Error('Recovery code contains unknown sessions.');
  return {
    selected: dictionary.filter((_, i) => bits[i >> 3] & (1 << (i % 8))),
    timezone: prefs[0],
    view: prefs[1],
  };
}
export const overlaps = (a, b) =>
  Date.parse(a.start) < Date.parse(b.end) &&
  Date.parse(b.start) < Date.parse(a.end);
const esc = (s) =>
  String(s || '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
const utc = (s) =>
  new Date(s)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const fold = (s) => {
  const chunks = [];
  let line = '';
  for (const c of s) {
    if (new TextEncoder().encode(line + c).length > 73) {
      chunks.push(line);
      line = ' ' + c;
    } else line += c;
  }
  chunks.push(line);
  return chunks.join('\r\n');
};
export function calendar(sessions) {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KubeCal//KubeCon NA 2026//EN',
      'CALSCALE:GREGORIAN',
      ...sessions.flatMap((s) => [
        'BEGIN:VEVENT',
        `UID:${esc(s.id)}@kubecal`,
        `DTSTAMP:${utc(new Date().toISOString())}`,
        `DTSTART:${utc(s.start)}`,
        `DTEND:${utc(s.end)}`,
        `SUMMARY:${esc(s.title)}`,
        `LOCATION:${esc(s.room)}`,
        `DESCRIPTION:${esc(s.description)}`,
        `URL:${s.url}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}
export function recoveryCode(input) {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value),
      match = url.hash.match(/^#\/snapshot\/([^/?#]+)$/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    // Malformed URLs fall through to the error below.
  }
  throw new Error('Enter a recovery code or a KubeCal snapshot link.');
}
