import {
  encodeState,
  decodeState,
  overlaps,
  calendar,
  recoveryCode,
  slideLinks,
  slidePreview,
  loadConvertedSlide,
  sessionAtNow,
  inSchedule,
  toggleSession,
  planDiff,
  applyPlanDiff,
} from './core.mjs';
import {
  emptyFilters,
  matchesFilters,
  filterQuery,
  parseFilters,
  fuzzyMatch,
  matchesSponsor,
} from './filters.mjs';
import { gridLanes, gridTimeline } from './grid-layout.mjs';
import { groupSpeakers } from './speakers.mjs';
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
const [data, dictionary, legacyDictionary, people, sponsorData, preset] =
  await Promise.all([
    fetch('./data/sessions.json').then((r) => r.json()),
    fetch('./data/dictionary-v2.json').then((r) => r.json()),
    fetch('./data/dictionary-v1.json').then((r) => r.json()),
    fetch('./data/speakers.json').then((r) => r.json()),
    fetch('./data/sponsors.json').then((r) => r.json()),
    fetch('./data/jays-plan.json').then((r) => r.json()),
  ]).catch(() => {
    document.querySelector('#main').innerHTML =
      '<h1>Schedule unavailable</h1><p role="alert">The schedule could not be loaded. Check your connection and reload this page.</p>';
    throw Error('Could not load schedule data');
  });
function restoreState(code) {
  return code.startsWith('KC2.')
    ? decodeState(code, dictionary, 2)
    : decodeState(code, legacyDictionary);
}
const updatedAt = $('#updated-at');
updatedAt.dateTime = data.updated;
updatedAt.textContent = new Date(
  `${data.updated}T00:00:00Z`,
).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
const peopleById = new Map(people.map((p) => [p.id, p]));
const speakerGroups = groupSpeakers(people);
const speakerGroupById = new Map(
  speakerGroups.flatMap((group) => group.map((person) => [person.id, group])),
);
const sessions = data.sessions,
  byId = new Map(sessions.map((s) => [s.id, s])),
  key = 'kubecal-2026-v1';
const defaults = { selected: [], timezone: 'America/Denver', view: 'simple' };
let state = { ...defaults },
  storageOK = true;
const diskStore = await fetch('./api/schedule')
  .then((r) =>
    r.headers.get('X-KubeCal-Store') === 'disk'
      ? r.status === 200
        ? r.text()
        : ''
      : null,
  )
  .catch(() => null);
try {
  const saved = diskStore || localStorage.getItem(key);
  if (saved) {
    const parsed = JSON.parse(saved);
    validate(parsed);
    state = parsed;
  }
} catch {
  storageOK = false;
  setTimeout(
    () =>
      notify(
        'Local storage is unavailable or invalid. Export a backup before leaving.',
      ),
    500,
  );
}
let jaysPlan = preset,
  presetStorageOK = true;
try {
  const savedPlan = localStorage.getItem('kubecal-jays-plan');
  if (savedPlan !== null) {
    const parsed = JSON.parse(savedPlan);
    const validIds = (ids) =>
      Array.isArray(ids) &&
      ids.every((id) => typeof id === 'string') &&
      new Set(ids).size === ids.length;
    if (validIds(parsed)) {
      jaysPlan = parsed;
    } else if (
      parsed &&
      validIds(parsed.added) &&
      validIds(parsed.removed) &&
      !parsed.added.some((id) => parsed.removed.includes(id))
    ) {
      jaysPlan = applyPlanDiff(preset, parsed);
    } else {
      throw Error();
    }
  }
} catch {
  presetStorageOK = false;
  setTimeout(
    () =>
      notify(
        'Jay’s Plan could not be loaded. Existing data was not overwritten.',
      ),
    500,
  );
}
let scheduleChoice = 'all';
try {
  const savedChoice = localStorage.getItem('kubecal-schedule-choice');
  if (['all', 'mine', 'jay'].includes(savedChoice))
    scheduleChoice = savedChoice;
} catch {
  // The schedule remains usable when browser storage is unavailable.
}
function chooseSchedule(choice) {
  scheduleChoice = choice;
  try {
    localStorage.setItem('kubecal-schedule-choice', choice);
  } catch {
    notify('Schedule selection could not be saved for your next visit.');
  }
}
let filters = emptyFilters(),
  mine = scheduleChoice === 'mine',
  filterOpen = false,
  headerFilterOpen = false,
  gridExpanded = false,
  snapshotMode = false;
const sponsorFilters = { levels: [], categories: [] };
const openFacets = new Set(),
  dayOverrides = new Map();
let printingSchedule = false;
function syncUrl() {
  const q = filterQuery(filters, state.view);
  history.replaceState(
    null,
    '',
    location.pathname +
      location.search +
      '#/' +
      (location.hash.startsWith('#/search') ? 'search' : '') +
      (q ? '?' + q : ''),
  );
}
function readUrl() {
  const q = location.hash.split('?')[1] || '';
  const parsed = parseFilters(q);
  filters = parsed.filters;
  if (['simple', 'expanded', 'grid', 'venue'].includes(parsed.view))
    state.view = parsed.view;
}
function validate(s) {
  if (
    !s ||
    !Array.isArray(s.selected) ||
    s.selected.some((x) => typeof x !== 'string') ||
    new Set(s.selected).size !== s.selected.length ||
    typeof s.timezone !== 'string' ||
    !['simple', 'expanded', 'grid', 'venue'].includes(s.view)
  )
    throw Error('Invalid schedule data.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.timezone });
  } catch {
    throw Error('Invalid timezone.');
  }
}
function save() {
  if (!storageOK) {
    notify('Local data was not overwritten. Export a backup.');
    return;
  }
  if (diskStore !== null) {
    fetch('./api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    })
      .then((r) => {
        if (!r.ok) throw Error();
      })
      .catch(() => notify('Changes could not be saved to disk.'));
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    storageOK = false;
    notify('Changes could not be saved. Export a backup.');
  }
}
let noticeTimer;
function notify(text) {
  const n = $('#modal').open ? $('#modal-notice') : $('#notice');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => n.classList.remove('show'), 6000);
}
let resultTimer;
function announceResults(text) {
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    $('#updates').textContent = text;
  }, 400);
}
function day(s) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: state.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(s));
}
function dayOpen(d) {
  return printingSchedule || (dayOverrides.get(d) ?? d >= day(new Date()));
}
function dateLabel(s) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(s));
}
function time(s) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(s));
}
function shortTime(s) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(s));
}
const activeSelections = () =>
  scheduleChoice === 'jay' ? jaysPlan : state.selected;
const activeState = () => ({ ...state, selected: activeSelections() });
const selected = (s) => activeSelections().includes(s.id);
function savePlan(next) {
  if (!presetStorageOK) {
    notify('Jay’s Plan could not be saved. Existing data was not overwritten.');
    return false;
  }
  try {
    localStorage.setItem(
      'kubecal-jays-plan',
      JSON.stringify(planDiff(preset, next)),
    );
    jaysPlan = next;
    return true;
  } catch {
    notify('Changes to Jay’s Plan could not be saved.');
    return false;
  }
}
function toggleSaved(id) {
  if (scheduleChoice === 'jay') {
    savePlan(toggleSession(jaysPlan, id));
  } else {
    state.selected = toggleSession(state.selected, id);
    save();
  }
}
const safeUrl = (u) => {
  try {
    let x = new URL(u);
    return ['https:', 'http:'].includes(x.protocol) ? x.href : '#';
  } catch {
    return '#';
  }
};
const colors = [
  '#e4edf8',
  '#f5e4f2',
  '#e5f3ef',
  '#f8ecd9',
  '#e9e7f7',
  '#dff3f5',
  '#f7e5e1',
];
function color(s) {
  let n = 0;
  for (const c of s.tags[0] || 'event') n += c.charCodeAt(0);
  return colors[n % colors.length];
}
const url = (s) => `#/session/${encodeURIComponent(s.id)}`;
const trackBadge = (s) =>
  s.tags[0] ? `<span class="track-label">${esc(s.tags[0])}</span>` : '';
const slides = (s) =>
  slideLinks(s).length
    ? `<button type="button" class="slide-icon" data-slides="${esc(s.id)}" aria-label="View slides for ${esc(s.title)}" title="View slides"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1"/><path d="M12 17v4m-4 0h8M7 13l3-3 3 2 4-4"/></svg></button>`
    : '';
const scheduleUrl = () => {
  const q = filterQuery(filters, state.view);
  return '#/' + (q ? '?' + q : '');
};
function saveButton(s, withLabel = false) {
  if (snapshotMode) return '';
  const label = scheduleChoice === 'jay' ? 'Jay’s Plan' : 'My Schedule';
  return `<button class="save ${selected(s) ? 'selected' : ''}" data-save="${esc(s.id)}" aria-label="${label}: ${esc(s.title)}, ${esc(dateLabel(s.start))}, ${esc(time(s.start))}, ${esc(s.room || 'location to be announced')}" aria-pressed="${selected(s)}">${withLabel ? (selected(s) ? `✓ Saved to ${label}` : `+ Add to ${label}`) : selected(s) ? '✓' : ''}</button>`;
}
function card(s, expanded = false) {
  const preview = expanded ? '' : ` data-preview="${esc(s.id)}"`;
  return `<article class="card" data-session="${esc(s.id)}"${preview} style="--bg:${color(s)};--accent:${color(s).replace('e4edf8', '7597c0').replace('f5e4f2', 'bd70aa').replace('e5f3ef', '62a78d').replace('f8ecd9', 'd9a657').replace('e9e7f7', '938ac7').replace('dff3f5', '66b4bd').replace('f7e5e1', 'd58475')}">${saveButton(s)}<div class="card-content"><div class="card-heading"><a${preview} href="${url(s)}">${esc(s.title)}</a><span class="card-heading-end">${trackBadge(s)}${expanded ? slides(s) : ''}</span></div><small>${expanded ? esc(time(s.start) + ' – ' + time(s.end)) + '<br>' : ''}${esc(s.room || 'Location To Be Announced')}</small>${s.speakers && !expanded ? `<span class="speakers">${esc(s.speakers)}</span>` : ''}${expanded ? `<div class="description">${esc(s.description.slice(0, 330))}${s.description.length > 330 ? '…' : ''}</div><span class="muted">${esc(s.speakers)}</span><div>${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>${expanded ? '' : slides(s)}</article>`;
}
function filtered() {
  return sessions
    .filter(
      (s) =>
        inSchedule(
          scheduleChoice,
          s.id,
          state.selected,
          jaysPlan,
          !!filters.search.trim(),
        ) && matchesFilters(s, filters, day),
    )
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) || a.title.localeCompare(b.title),
    );
}
function dayLabel(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(d + 'T12:00:00Z'));
}
const uniq = (a) =>
  [...new Set(a.filter(Boolean))].sort((a, b) => a.localeCompare(b));
const tags = uniq(sessions.flatMap((s) => s.tags)),
  levels = ['Beginner', 'Intermediate', 'Advanced', 'Any Level', 'Any'];
function options(values, current, all) {
  return (
    (all ? `<option value="">${all}</option>` : '') +
    values
      .map(
        (v) =>
          `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`,
      )
      .join('')
  );
}
function sidebar() {
  const dates = uniq(sessions.map((s) => day(s.start)));
  const facet = (name, label, values) =>
    `<details class="facet" data-facet-details="${name}" ${openFacets.has(name) ? 'open' : ''}><summary>${label}${filters[name].length ? ` (${filters[name].length})` : ''}</summary><fieldset><legend class="sr-only">${label}</legend>${values.map((v) => `<label><input type="checkbox" data-facet="${name}" value="${esc(v)}" ${filters[name].includes(v) ? 'checked' : ''}> <span>${esc(name === 'date' ? dayLabel(v) : name === 'level' ? { Beginner: '🌱 Beginner', Intermediate: '🌿 Intermediate', Advanced: '🌳 Advanced', 'Any Level': '✨ Any Level', Any: '✨ Any' }[v] || v : v)}</span></label>`).join('')}</fieldset></details>`;
  return `<aside id="filters-panel" class="sidebar ${filterOpen ? 'open' : ''}" aria-label="Filter sessions"><label for="filter-search">Search Schedule</label><input id="filter-search" type="search" placeholder="Sessions or speakers" value="${esc(filters.search)}">${facet('date', 'Date', dates)}${facet('venue', 'Venue', uniq(sessions.map((s) => s.room)))}${facet(
    'type',
    'Type',
    tags.filter((t) => !levels.includes(t)),
  )}${facet(
    'level',
    'Experience Level',
    levels.filter((t) => tags.includes(t)),
  )}<label class="slides-filter"><input type="checkbox" id="filter-slides" ${filters.slides ? 'checked' : ''}> <span>Has slides</span></label><label for="timezone">Timezone</label><select id="timezone">${options(uniq(['America/Denver', state.timezone, ...(Intl.supportedValuesOf?.('timeZone') || [])]), state.timezone, 'Choose Timezone')}</select><button class="tool-button clear" data-action="clear">Clear Filters</button></aside>`;
}
function grouped(list, view) {
  let html = '',
    lastDay = '',
    lastTime = '',
    lastRoom = '';
  if (!list.length)
    return '<div class="empty">No sessions match. Try clearing your filters or choosing another date.</div>';
  if (view === 'venue')
    list = [...list].sort(
      (a, b) =>
        day(a.start).localeCompare(day(b.start)) ||
        a.room.localeCompare(b.room) ||
        a.start.localeCompare(b.start),
    );
  for (const s of list) {
    const d = day(s.start);
    if (d !== lastDay) {
      if (lastTime && view !== 'venue') html += '</div></div>';
      lastTime = '';
      lastRoom = '';
      if (lastDay) html += '</details>';
      html += `<details class="day-section" data-day="${esc(d)}" ${dayOpen(d) ? 'open' : ''}><summary class="day-heading">${esc(dayLabel(d))}</summary>`;
      lastDay = d;
    }
    if (view === 'venue') {
      if (s.room !== lastRoom) {
        html += `<h3 class="venue-heading">${esc(s.room || 'Location To Be Announced')}</h3>`;
        lastRoom = s.room;
      }
      html += `<div class="venue-row" data-session="${esc(s.id)}">${saveButton(s)}<span class="venue-time">${esc(time(s.start))}</span><a data-preview="${esc(s.id)}" href="${url(s)}">${esc(s.title)}</a>${trackBadge(s)}${slides(s)}</div>`;
    } else {
      let t = time(s.start);
      if (t !== lastTime) {
        if (lastTime) html += '</div></div>';
        html += `<div class="slot"><div class="slot-time">${esc(t)}</div><div class="cards ${view === 'expanded' ? 'expanded' : ''}">`;
        lastTime = t;
      }
      html += card(s, view === 'expanded');
    }
  }
  if (lastTime && view !== 'venue') html += '</div></div>';
  if (lastDay) html += '</details>';
  return html;
}
function grid(list) {
  if (!list.length)
    return '<div class="empty">No sessions match these filters.</div>';
  let html = '';
  for (const d of uniq(list.map((s) => day(s.start)))) {
    const items = list.filter((s) => day(s.start) === d),
      rooms = uniq(items.map((s) => s.room || 'Location To Be Announced'));
    const columns = rooms.map((room) => {
      const lanes = gridLanes(
        items.filter((s) => (s.room || 'Location To Be Announced') === room),
      );
      return { room, ...lanes, width: Math.max(190, lanes.count * 130) };
    });
    const minute = (s) => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: state.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(s));
      return (
        +parts.find((x) => x.type === 'hour').value * 60 +
        +parts.find((x) => x.type === 'minute').value
      );
    };
    const start =
        Math.floor(Math.min(...items.map((s) => minute(s.start))) / 60) * 60,
      end = Math.min(
        1440,
        Math.ceil(
          Math.max(
            ...items.map((s) => (day(s.end) !== d ? 1440 : minute(s.end))),
          ) / 60,
        ) * 60,
      ),
      nowMinute = day(new Date()) === d ? minute(new Date()) : null,
      timeline = gridTimeline(
        start,
        end,
        items.map((s) => {
          const from = minute(s.start);
          return {
            start: from,
            end: from + (Date.parse(s.end) - Date.parse(s.start)) / 60000,
          };
        }),
        nowMinute === null ? [] : [nowMinute],
      ),
      height = timeline.get(end);
    html += `<details class="day-section" data-day="${esc(d)}" ${dayOpen(d) ? 'open' : ''}><summary class="day-heading">${esc(dayLabel(d))}</summary><p class="muted">Drag to pan or scroll horizontally to see more rooms. Choose simple or expanded view for a chronological list.</p><div class="grid-wrap" role="region" tabindex="0" aria-label="Schedule for ${esc(dateLabel(items[0].start))}; scroll to see rooms"><div class="grid" style="width:${75 + columns.reduce((sum, c) => sum + c.width, 0)}px"><div class="grid-head"><span>Time</span>${columns.map((c) => `<span style="width:${c.width}px">${esc(c.room)}</span>`).join('')}</div><div class="grid-body" style="height:${height}px">`;
    for (let t = start; t <= end; t += 15)
      html += `<div class="grid-line" style="top:${timeline.get(t)}px"></div><div class="grid-time" style="top:${timeline.get(t)}px">${Math.floor(t / 60) % 12 || 12}:${String(t % 60).padStart(2, '0')}${t < 720 ? 'am' : 'pm'}</div>`;
    if (nowMinute !== null && timeline.has(nowMinute))
      html += `<div class="grid-now" data-now aria-hidden="true" style="top:${timeline.get(nowMinute)}px"></div>`;
    let left = 75;
    for (const column of columns) {
      const width = column.width / column.count;
      for (const [s, i, displayEnd] of column.assigned) {
        let from = minute(s.start),
          to = Math.min(
            end,
            from + (Date.parse(displayEnd) - Date.parse(s.start)) / 60000,
          ),
          top = timeline.get(from),
          dur = timeline.get(to) - top;
        html += `<div data-session="${esc(s.id)}" class="grid-event ${dur < 72 ? 'compact' : ''} ${dur < 24 ? 'micro' : ''}" data-preview="${esc(s.id)}" style="left:${left + i * width}px;top:${top}px;width:${width}px;height:${dur}px;background:${color(s)}">${trackBadge(s)}<div class="grid-event-main">${saveButton(s)}<a draggable="false" data-preview="${esc(s.id)}" href="${url(s)}" aria-label="${esc(s.title)}, ${esc(time(s.start))} to ${esc(time(s.end))}, ${esc(column.room)}">${esc(s.title)}</a>${slides(s)}</div><span class="grid-event-time">${esc(shortTime(s.start))} – ${esc(shortTime(s.end))}</span></div>`;
      }
      left += column.width;
    }
    html += '</div></div></div></details>';
  }
  return html;
}
function schedule() {
  let list = filtered(),
    count = `${list.length} ${list.length === 1 ? 'session' : 'sessions'}${mine ? ' in your schedule' : scheduleChoice === 'jay' ? (filters.search.trim() ? ' matching your search' : ' in Jay’s Plan') : ''}`;
  $('#main').innerHTML =
    `<h1 class="sr-only">Schedule</h1><div class="layout ${gridExpanded && state.view === 'grid' ? 'grid-expanded' : ''}"><div class="toolbar"><div class="tabs" role="group" aria-label="Schedule selection"><button data-action="all" aria-pressed="${scheduleChoice === 'all'}" class="${scheduleChoice === 'all' ? 'active' : ''}">Event Schedule</button><button data-action="mine" aria-pressed="${mine}" class="${mine ? 'active' : ''}">My Schedule <span class="count">${state.selected.length}</span></button><button data-action="jay" aria-pressed="${scheduleChoice === 'jay'}" class="${scheduleChoice === 'jay' ? 'active' : ''}">Jay’s Plan</button></div><button class="tool-button" data-action="now" type="button">Now</button><button class="filter-toggle" data-action="filters" aria-controls="filters-panel" aria-expanded="${filterOpen}">Filters</button><div class="view-switch" role="group" aria-label="Schedule View">${[
      [
        'simple',
        'Simple',
        '<path d="M4 6h2m3 0h11M4 12h2m3 0h11M4 18h2m3 0h11"/>',
      ],
      ['expanded', 'Expanded', '<path d="M4 5h16M4 9h11M4 14h16M4 18h11"/>'],
      [
        'grid',
        'Grid',
        '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
      ],
      [
        'venue',
        'Venue',
        '<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12Z"/><circle cx="12" cy="9" r="2"/>',
      ],
    ]
      .map(
        ([value, label, icon]) =>
          `<button data-view="${value}" title="${label} View" aria-label="${label} View" aria-pressed="${state.view === value}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${label}</span></button>`,
      )
      .join(
        '',
      )}</div>${state.view === 'grid' ? `<button class="tool-button" data-action="expand-grid" aria-pressed="${gridExpanded}">Full Width</button>` : ''}</div>${sidebar()}<div class="schedule-results">${mine && state.selected.some((id) => !byId.has(id)) ? '<p class="warning">Some saved sessions are not present in this snapshot. They remain in your backup.</p>' : ''}<div class="muted">${count}</div>${state.view === 'grid' ? grid(list) : grouped(list, state.view)}${scheduleChoice === 'jay' ? '<div class="actions"><button class="tool-button" data-action="restore-plan">Restore Original Plan</button><button class="tool-button" data-action="empty-plan">Clear Plan</button></div>' : ''}</div></div>`;
  announceResults(count);
}
function sessionContent(s) {
  const conflicts = sessions.filter(
    (x) => x.id !== s.id && selected(x) && overlaps(s, x),
  );
  return `<div class="session-content">${saveButton(s, true)}<p class="meta">${esc(dateLabel(s.start))}<br>${esc(time(s.start))} – ${esc(time(s.end))}<br>${esc(s.room || 'Location To Be Announced')}</p>${conflicts.length ? `<p class="warning">Overlaps with ${conflicts.length} saved ${conflicts.length === 1 ? 'session' : 'sessions'}. You can save both.</p>` : ''}<p class="body">${esc(s.description || 'No description provided.')}</p>${s.speakers ? `<p>${s.speakerIds?.length ? s.speakerIds.map((id) => `<a href="#/speaker/${encodeURIComponent(id)}">${esc(peopleById.get(id)?.name || 'Speaker')}</a>`).join(', ') : esc(s.speakers)}</p>` : ''}<div>${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div><p><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">View official session</a></p>${s.links.map((l) => `<p><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label || 'Session link')}</a></p>`).join('')}</div>`;
}
function detail(s) {
  if (!s) {
    $('#main').innerHTML =
      '<div class="detail"><h1>Session not found</h1><a href="#/">Return to schedule</a></div>';
    return;
  }
  $('#main').innerHTML =
    `<article class="detail"><a href="${esc(scheduleUrl())}">← Back to schedule</a><h1>${esc(s.title)}</h1>${sessionContent(s)}</article>`;
}
function speakers() {
  let speakers = speakerGroups
    .filter((group) =>
      sessions.some((s) =>
        s.speakerIds?.some((id) => group.some((p) => p.id === id)),
      ),
    )
    .map((group) => group[0])
    .sort((a, b) => a.name.localeCompare(b.name));
  $('#main').innerHTML =
    `<section class="directory speakers-directory"><h1>Speakers</h1><input id="speaker-search" type="search" placeholder="Find a Speaker"><p id="speaker-count">${speakers.length} speakers</p><div class="directory-grid" id="people">${speakers.map((p) => `<div class="person speaker-card" data-name="${esc((p.name + ' ' + p.company).toLowerCase())}"><span class="speaker-placeholder" aria-hidden="true">${esc(p.name.charAt(0))}</span>${p.photo ? `<img src="${esc(safeUrl(p.photo))}" alt="" loading="lazy">` : ''}<a href="#/speaker/${encodeURIComponent(p.id)}">${esc(p.name)}</a><p class="muted">${esc(p.role || p.tagline)}${p.role && p.company ? `<br>${esc(p.company)}` : ''}</p></div>`).join('')}</div></section>`;
}
function speaker(id) {
  let p = peopleById.get(id),
    ids = new Set((speakerGroupById.get(id) || []).map((person) => person.id)),
    list = sessions.filter((s) =>
      s.speakerIds?.some((speakerId) => ids.has(speakerId)),
    );
  if (!p) {
    $('#main').innerHTML =
      '<section class="directory"><h1>Speaker not found</h1><a href="#/speakers">All speakers</a></section>';
    return;
  }
  $('#main').innerHTML =
    `<section class="directory"><a href="#/speakers">← All speakers</a><div class="speaker-header">${p.photo ? `<img src="${esc(safeUrl(p.photo))}" alt="" loading="lazy">` : ''}<div><h1>${esc(p.name)}</h1><p>${esc(p.role || p.tagline)}${p.role && p.company ? `<br>${esc(p.company)}` : ''}</p></div></div>${p.bio ? `<h2>About</h2><p class="body">${esc(p.bio)}</p>` : ''}${p.links.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.title || 'Website')}</a> `).join('')}<h2>Sessions</h2>${grouped(
      list.sort((a, b) => a.start.localeCompare(b.start)),
      'simple',
    )}</section>`;
}
function badgeHue(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}
function sponsorBadge(value, level = false) {
  return `<span class="sponsor-badge${level ? ` sponsor-level-${esc(value.toLowerCase().replace(/[^a-z]+/g, '-'))}` : ''}" style="--badge-hue:${badgeHue(value)}">${esc(value)}</span>`;
}
function sponsors() {
  const levelOrder = [
    'Diamond',
    'Platinum',
    'Gold',
    'Silver',
    'End User',
    'Start-Up',
  ];
  const levels = uniq(sponsorData.map((s) => s.level)).sort(
      (a, b) =>
        (levelOrder.indexOf(a) < 0
          ? levelOrder.length
          : levelOrder.indexOf(a)) -
        (levelOrder.indexOf(b) < 0 ? levelOrder.length : levelOrder.indexOf(b)),
    ),
    categories = uniq(sponsorData.flatMap((s) => s.categories));
  const facet = (name, title, values, selected) =>
    `<details class="sponsor-facet"><summary>${title}${selected.length ? ` (${selected.length})` : ''}</summary><fieldset><legend class="sr-only">${title}</legend>${values.map((value) => `<label><input type="checkbox" data-sponsor-filter="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''}>${sponsorBadge(value, name === 'levels')}</label>`).join('')}</fieldset></details>`;
  $('#main').innerHTML =
    `<section class="directory sponsors"><h1>Sponsors</h1><div class="sponsor-filters"><label class="sponsor-search-label" for="sponsor-search">Search Sponsors<input id="sponsor-search" type="search" placeholder="Company name or solution"></label>${facet('levels', 'Level', levels, sponsorFilters.levels)}${facet('categories', 'Solutions', categories, sponsorFilters.categories)}<button type="button" class="tool-button" data-action="clear-sponsors">Clear Filters</button></div><p id="sponsor-count" role="status" aria-live="polite"></p><div class="directory-grid" id="sponsor-results"></div></section>`;
  updateSponsors();
}
function updateSponsors() {
  hideSponsor();
  const q = $('#sponsor-search').value;
  const list = sponsorData.filter((s) =>
    matchesSponsor(s, q, sponsorFilters.levels, sponsorFilters.categories),
  );
  $('#sponsor-count').textContent =
    `${list.length} ${list.length === 1 ? 'sponsor' : 'sponsors'}`;
  $('#sponsor-results').innerHTML =
    list
      .map(
        (s) =>
          `<article class="person sponsor">${s.logo ? `<img src="${esc(safeUrl(s.logo))}" alt="" loading="lazy">` : ''}<h2>${esc(s.name)}</h2><div class="sponsor-meta">${s.level ? sponsorBadge(s.level, true) : ''}${s.booth ? `<span>Booth ${esc(s.booth)}</span>` : ''}</div>${s.categories.length ? `<div class="sponsor-badges">${s.categories.map((category) => sponsorBadge(category)).join('')}</div>` : ''}<div class="sponsor-actions">${s.description ? `<button class="sponsor-about" type="button" data-sponsor-about="${sponsorData.indexOf(s)}" aria-expanded="false" aria-controls="sponsor-popover">About <span class="sr-only">${esc(s.name)}</span></button>` : ''}${s.website ? `<a href="${esc(safeUrl(s.website))}" target="_blank" rel="noopener">Visit website <span class="sr-only">for ${esc(s.name)}</span></a>` : ''}</div></article>`,
      )
      .join('') || '<p>No sponsors match these filters.</p>';
  document.querySelectorAll('[data-sponsor-filter]').forEach((input) => {
    const summary = input.closest('details').querySelector('summary');
    const selected = sponsorFilters[input.dataset.sponsorFilter];
    const title =
      input.dataset.sponsorFilter === 'levels' ? 'Level' : 'Solutions';
    summary.textContent =
      title + (selected.length ? ` (${selected.length})` : '');
  });
}
function snapshot(code) {
  let shared;
  try {
    shared = restoreState(code);
  } catch {
    $('#main').innerHTML =
      '<section class="detail"><h1>Invalid Snapshot</h1><p>This link is incomplete or damaged.</p><a href="#/">Return to Schedule</a></section>';
    return;
  }
  const previous = state;
  state = shared;
  snapshotMode = true;
  try {
    const list = sessions
      .filter(selected)
      .sort(
        (a, b) =>
          a.start.localeCompare(b.start) || a.title.localeCompare(b.title),
      );
    $('#main').innerHTML =
      `<section class="snapshot"><h1>Shared Schedule</h1><p>This is a read-only snapshot of ${shared.selected.length} saved ${shared.selected.length === 1 ? 'session' : 'sessions'}. Its selections are fixed; session details reflect this site’s schedule data.</p><div class="actions"><button class="tool-button" data-action="import-snapshot" data-code="${esc(code)}">Import Snapshot</button></div>${shared.selected.some((id) => !byId.has(id)) ? '<p class="warning">Some sessions are unavailable in this schedule snapshot.</p>' : ''}${grouped(list, 'simple')}</section>`;
  } finally {
    state = previous;
    snapshotMode = false;
  }
}
function render() {
  hideSponsor();
  hidePreview();
  const panelScroll = headerFilterOpen ? $('#filters-panel')?.scrollTop : 0;
  const route = location.hash.slice(2).split('?')[0].split('/'),
    page = route[0] || '';
  const schedulePage = !page || page === 'search';
  document.body.classList.toggle('schedule-page', schedulePage);
  document.querySelector('.banner').hidden = !schedulePage;
  document.body.classList.toggle(
    'wide-grid',
    gridExpanded && state.view === 'grid' && schedulePage,
  );
  document.querySelectorAll('.main-nav>a, .mobile-nav>a').forEach((a) => {
    const active =
      a.getAttribute('href') ===
      (page === 'speakers' || page === 'speaker'
        ? '#/speakers'
        : page === 'sponsors'
          ? '#/sponsors'
          : '#/');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (page === 'snapshot') snapshot(route[1] || '');
  else if (page === 'session')
    detail(byId.get(decodeURIComponent(route[1] || '')));
  else if (page === 'speakers') speakers();
  else if (page === 'speaker') speaker(decodeURIComponent(route[1] || ''));
  else if (page === 'sponsors') sponsors();
  else schedule();
  updateHeader();
  if (headerFilterOpen && $('#filters-panel'))
    $('#filters-panel').scrollTop = panelScroll || 0;
}
function showModal(title, content) {
  $('#modal-title').textContent = title;
  $('#modal-content').innerHTML = content;
  $('#modal').showModal();
}
let slideManifest,
  slideRequest = 0,
  slideController,
  slideObjectUrls = [];
async function showSlides(session) {
  if (!session) return;
  const modal = $('#modal');
  const request = ++slideRequest;
  slideController = new AbortController();
  modal.classList.add('slide-viewer');
  showModal(session.title, '<p>Loading slides…</p>');
  slideManifest ||= fetch('./slides/2026/manifest.json')
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}));
  const manifest = await slideManifest;
  if (
    request !== slideRequest ||
    !modal.open ||
    !modal.classList.contains('slide-viewer')
  )
    return;
  $('#modal-content').innerHTML = slideLinks(session)
    .map((link) => {
      const preview = slidePreview(
        link.url,
        manifest,
        document.querySelector('meta[name=proxy]')?.content &&
          new URL(
            document.querySelector('meta[name=proxy]').content,
            location.href,
          ).href,
      );
      const source = safeUrl(link.url);
      let name;
      try {
        name = decodeURIComponent(new URL(link.url).pathname.split('~').pop());
      } catch {
        name = 'Slide file';
      }
      const converting = preview && name.toLowerCase().endsWith('.pptx');
      return `<section class="slide-deck"${converting ? ` data-convert="${esc(preview.src)}" data-source="${esc(source)}"` : ''}>${converting ? '<div class="slide-loading" role="status"><p>Preparing PowerPoint preview…</p><progress aria-label="Preparing PowerPoint preview"></progress></div>' : preview ? (preview.type === 'pdf' ? `<iframe title="${esc(session.title)} slides" src="${esc(preview.src)}"></iframe>` : `<img src="${esc(preview.src)}" alt="${esc(session.title)} slides"><p><a href="${esc(source)}" target="_blank" rel="noopener">Download image</a></p>`) : `<div class="slide-deck-actions"><span>${esc(name)}</span><a href="${esc(source)}" target="_blank" rel="noopener">Download</a></div><p>${name.toLowerCase().endsWith('.pptx') ? 'PowerPoint preview is available when running KubeCal locally with <code>just serve local</code>. Download the file to view it here.' : 'Preview unavailable. Download the file to view it.'}</p>`}</section>`;
    })
    .join('');
  const signal = slideController.signal;
  for (const section of modal.querySelectorAll('[data-convert]')) {
    loadConvertedSlide(section.dataset.convert, signal)
      .then((blob) => {
        if (signal.aborted) return;
        const src = URL.createObjectURL(blob);
        slideObjectUrls.push(src);
        const iframe = document.createElement('iframe');
        iframe.title = `${session.title} slides`;
        iframe.src = src;
        section.replaceChildren(iframe);
      })
      .catch(() => {
        if (!signal.aborted)
          section.innerHTML = `<p>Could not prepare this preview. <a href="${esc(section.dataset.source)}" target="_blank" rel="noopener">Download the original file</a>.</p>`;
      });
  }
}
$('#modal').addEventListener('close', () => {
  if ($('#modal').classList.contains('slide-viewer')) {
    slideRequest++;
    slideController?.abort();
    slideObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    slideObjectUrls = [];
    $('#modal').classList.remove('slide-viewer');
    $('#modal-content').replaceChildren();
  }
});
function download(name, content, type) {
  let a = document.createElement('a');
  let u = URL.createObjectURL(new Blob([content], { type }));
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function openImport() {
  showModal(
    'Import Schedule',
    `<p>Paste a recovery code or snapshot link, or choose a backup file. You can review it before importing.</p><label for="recovery">Recovery Code or Snapshot Link</label><textarea id="recovery" spellcheck="false"></textarea><div class="actions"><button data-modal="preview-code">Review Import</button></div><label class="file-label" for="import-file">Import Backup File</label><input id="import-file" type="file" accept="application/json,.json"><div id="import-preview" role="status" aria-live="polite"></div>`,
  );
}
function openExport() {
  let code;
  try {
    code = encodeState(activeState(), dictionary, 2);
  } catch (e) {
    code = '';
    notify(e.message);
  }
  showModal(
    'Export Schedule',
    `<p>Download a backup or copy this recovery code to move your saved schedule to another device.</p><label for="recovery">Recovery Code</label><textarea id="recovery" readonly spellcheck="false">${esc(code)}</textarea><div class="actions"><button data-modal="copy">Copy Code</button><button data-modal="export">Download Backup</button></div><p class="muted">This code is a snapshot. Anyone with it can view your selections; later changes do not sync.</p>`,
  );
}
function preview(next) {
  validate(next);
  let unknown = next.selected.filter((id) => !byId.has(id));
  $('#import-preview').innerHTML =
    `<p>Ready to import into ${scheduleChoice === 'jay' ? 'Jay’s Plan' : 'My Schedule'}: ${next.selected.length} saved ${next.selected.length === 1 ? 'session' : 'sessions'}${unknown.length ? ` (${unknown.length} no longer in this snapshot)` : ''}.</p><div class="actions"><button class="primary" data-modal="replace">Replace</button><button data-modal="merge">Merge Selections</button></div>`;
  pending = next;
}
let pending = null;
function calendarModal() {
  showModal(
    'Download Calendar',
    `<p>Calendar files are one-time snapshots; they will not update automatically.</p><div class="actions"><button data-modal="ics-current">${mine ? 'My Schedule' : 'Current Schedule'} (${filtered().length})</button><button data-modal="ics-all">Full Event Schedule</button></div>`,
  );
}
const sponsorPopover = $('#sponsor-popover');
let sponsorAnchor = null,
  sponsorPinned = false,
  sponsorCloseTimer;
function hideSponsor() {
  clearTimeout(sponsorCloseTimer);
  sponsorAnchor?.setAttribute('aria-expanded', 'false');
  sponsorPopover.hidden = true;
  sponsorAnchor = null;
  sponsorPinned = false;
}
function showSponsor(anchor, pinned = false) {
  const sponsor = sponsorData[Number(anchor.dataset.sponsorAbout)];
  if (!sponsor) return;
  clearTimeout(sponsorCloseTimer);
  if (sponsorAnchor && sponsorAnchor !== anchor)
    sponsorAnchor.setAttribute('aria-expanded', 'false');
  sponsorAnchor = anchor;
  sponsorPinned = pinned;
  sponsorPopover.querySelector('strong').textContent = sponsor.name;
  sponsorPopover.querySelector('.sponsor-popover-body').textContent =
    sponsor.description;
  sponsorPopover.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect(),
    box = sponsorPopover.getBoundingClientRect();
  const left = Math.max(
    12,
    Math.min(r.left, document.documentElement.clientWidth - box.width - 12),
  );
  const top =
    r.bottom + box.height + 8 <= innerHeight
      ? r.bottom + 8
      : Math.max(12, r.top - box.height - 8);
  sponsorPopover.style.left = `${left}px`;
  sponsorPopover.style.top = `${top}px`;
}
document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  if (sponsorPopover.contains(e.target)) clearTimeout(sponsorCloseTimer);
  const anchor = e.target.closest('[data-sponsor-about]');
  if (anchor && (!sponsorPinned || anchor === sponsorAnchor))
    showSponsor(anchor, sponsorPinned);
});
document.addEventListener('pointerout', (e) => {
  if (sponsorPinned || !sponsorAnchor) return;
  if (
    (sponsorAnchor.contains(e.target) || sponsorPopover.contains(e.target)) &&
    !sponsorAnchor.contains(e.relatedTarget) &&
    !sponsorPopover.contains(e.relatedTarget)
  ) {
    sponsorCloseTimer = setTimeout(hideSponsor, 250);
  }
});
document.addEventListener('click', (e) => {
  const anchor = e.target.closest('[data-sponsor-about]');
  if (anchor) {
    if (sponsorAnchor === anchor && sponsorPinned) hideSponsor();
    else showSponsor(anchor, true);
  } else if (
    e.target.closest('.sponsor-popover-close') ||
    !sponsorPopover.contains(e.target)
  )
    hideSponsor();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !sponsorPopover.hidden) {
    const anchor = sponsorAnchor;
    hideSponsor();
    anchor?.focus();
  }
});
window.addEventListener(
  'scroll',
  (e) => {
    if (!sponsorPopover.contains(e.target)) hideSponsor();
  },
  true,
);
window.addEventListener('resize', hideSponsor);
const previewBox = $('#event-preview');
function positionPreview(x, y) {
  const w = previewBox.offsetWidth,
    h = previewBox.offsetHeight;
  let left = x + 16,
    top = y + 18;
  if (left + w > innerWidth - 12) left = x - w - 16;
  if (top + h > innerHeight - 12) top = y - h - 16;
  previewBox.style.left = `${Math.max(12, left)}px`;
  previewBox.style.top = `${Math.max(12, top)}px`;
}
function showPreview(link, event) {
  const session = byId.get(link.dataset.preview);
  if (!session) return;
  previewBox.innerHTML = `<strong>${esc(session.title)}</strong><p>${esc(dateLabel(session.start))}<br>${esc(time(session.start))} – ${esc(time(session.end))}</p><p>${esc(session.room || 'Location To Be Announced')}</p>${session.speakers ? `<p>${esc(session.speakers)}</p>` : ''}${session.tags.length ? `<p class="preview-track">${session.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</p>` : ''}${session.description ? `<p class="preview-description">${esc(session.description)}</p>` : ''}`;
  previewBox.hidden = false;
  const r = link.getBoundingClientRect();
  positionPreview(event?.clientX ?? r.right, event?.clientY ?? r.bottom);
  link.setAttribute('aria-describedby', 'event-preview');
}
function hidePreview() {
  previewBox.hidden = true;
  document
    .querySelectorAll('[aria-describedby="event-preview"]')
    .forEach((el) => el.removeAttribute('aria-describedby'));
}
$('#main').addEventListener('pointerover', (e) => {
  const link = e.target.closest('.slide-icon')
    ? null
    : e.target.closest('[data-preview]');
  if (link && e.pointerType !== 'touch' && !dragState) showPreview(link, e);
});
$('#main').addEventListener('pointerout', (e) => {
  const link = e.target.closest('[data-preview]');
  if (
    link &&
    !link.contains(e.relatedTarget) &&
    document.activeElement !== link
  )
    hidePreview();
});
$('#main').addEventListener('focusin', (e) => {
  const link = e.target.closest('.slide-icon')
    ? null
    : e.target.closest('[data-preview]');
  if (link) showPreview(link);
});
$('#main').addEventListener('focusout', (e) => {
  if (e.target.closest('[data-preview]')) hidePreview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hidePreview();
});
window.addEventListener('scroll', hidePreview, true);
window.addEventListener('resize', hidePreview);
let dragState = null,
  suppressClick = false;
$('#main').addEventListener('pointerdown', (e) => {
  const wrap = e.target.closest('.grid-wrap');
  if (
    !wrap ||
    e.pointerType !== 'mouse' ||
    e.button !== 0 ||
    e.target.closest('button')
  )
    return;
  dragState = {
    wrap,
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    left: wrap.scrollLeft,
    top: wrap.scrollTop,
    moved: false,
  };
});
$('#main').addEventListener('pointermove', (e) => {
  if (!dragState) {
    if (
      !previewBox.hidden &&
      e.pointerType === 'mouse' &&
      e.target.closest('[data-preview]')
    )
      positionPreview(e.clientX, e.clientY);
    return;
  }
  if (e.pointerId !== dragState.id) return;
  const d = dragState,
    dx = e.clientX - d.x,
    dy = e.clientY - d.y;
  if (!d.moved && Math.hypot(dx, dy) > 5) {
    d.moved = true;
    d.wrap.setPointerCapture(e.pointerId);
    d.wrap.classList.add('dragging');
    hidePreview();
  }
  if (d.moved) {
    e.preventDefault();
    d.wrap.scrollLeft = d.left - dx;
    d.wrap.scrollTop = d.top - dy;
  }
});
function finishDrag(e) {
  if (!dragState || e.pointerId !== dragState.id) return;
  const d = dragState;
  dragState = null;
  d.wrap.classList.remove('dragging');
  if (d.moved) {
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  if (d.wrap.hasPointerCapture(e.pointerId))
    d.wrap.releasePointerCapture(e.pointerId);
}
$('#main').addEventListener('pointerup', finishDrag);
$('#main').addEventListener('pointercancel', finishDrag);
$('#main').addEventListener('lostpointercapture', finishDrag);
$('#main').addEventListener(
  'click',
  (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressClick = false;
    }
  },
  true,
);
$('#main').addEventListener(
  'wheel',
  (e) => {
    const wrap = e.target.closest('.grid-wrap');
    if (!wrap || !e.shiftKey || e.deltaX || !e.deltaY) return;
    const before = wrap.scrollLeft;
    wrap.scrollLeft += e.deltaY;
    if (wrap.scrollLeft !== before) e.preventDefault();
  },
  { passive: false },
);
$('#main').addEventListener(
  'error',
  (e) => {
    if (e.target.matches('.speaker-card img')) e.target.hidden = true;
  },
  true,
);
$('#main').addEventListener(
  'toggle',
  (e) => {
    if (e.target.dataset.day) {
      if (!printingSchedule) {
        const d = e.target.dataset.day;
        if (e.target.open === d >= day(new Date())) dayOverrides.delete(d);
        else dayOverrides.set(d, e.target.open);
      }
    }
    if (e.target.dataset.facetDetails) {
      if (e.target.open) openFacets.add(e.target.dataset.facetDetails);
      else openFacets.delete(e.target.dataset.facetDetails);
    }
    if (e.target.matches('.sponsor-facet') && e.target.open) {
      document.querySelectorAll('.sponsor-facet[open]').forEach((facet) => {
        if (facet !== e.target) facet.open = false;
      });
    }
  },
  true,
);
let overlaySession = null,
  overlayDirty = false;
$('#main').addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#/session/"]');
  const page = location.hash.slice(2).split('?')[0];
  if (
    link &&
    (!page || page === 'search') &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  ) {
    const session = byId.get(
      decodeURIComponent(link.getAttribute('href').slice('#/session/'.length)),
    );
    if (session) {
      e.preventDefault();
      hidePreview();
      overlaySession = session;
      showModal(
        session.title,
        `${sessionContent(session)}<p><a href="${url(session)}">Open event page</a></p>`,
      );
    }
    return;
  }
  const slideButton = e.target.closest('[data-slides]');
  if (slideButton) {
    hidePreview();
    showSlides(byId.get(slideButton.dataset.slides));
    return;
  }
  const view = e.target.closest('[data-view]');
  if (view) {
    state.view = view.dataset.view;
    save();
    syncUrl();
    render();
    document.querySelector(`[data-view="${state.view}"]`)?.focus();
    return;
  }
  const saveEl = e.target.closest('[data-save]');
  if (saveEl) {
    let id = saveEl.dataset.save;
    toggleSaved(id);
    render();
    const next = [...document.querySelectorAll('[data-save]')].find(
      (x) => x.dataset.save === id,
    );
    (
      next ||
      document.querySelector(
        `[data-action=${scheduleChoice === 'jay' ? 'jay' : 'mine'}]`,
      ) ||
      $('#main')
    ).focus();
    if (!next)
      notify(
        `Session removed from ${scheduleChoice === 'jay' ? 'Jay’s Plan' : 'My Schedule'}.`,
      );
    return;
  }
  let a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'now') {
    scrollToNow();
  } else if (a === 'all' || a === 'mine' || a === 'jay') {
    chooseSchedule(a);
    mine = a === 'mine';
    render();
    document.querySelector(`[data-action="${a}"]`)?.focus();
  } else if (a === 'restore-plan' || a === 'empty-plan') {
    const restore = a === 'restore-plan';
    showModal(
      restore ? 'Restore Original Plan' : 'Clear Jay’s Plan',
      `<p>${restore ? 'Replace your edits with the original 19-session plan?' : 'Remove all sessions from Jay’s Plan?'}</p><p>This replaces the plan saved in this browser. Export a backup first if you want to keep it.</p><div class="actions"><button class="primary" data-modal="${restore ? 'confirm-restore-plan' : 'confirm-empty-plan'}">${restore ? 'Restore Original Plan' : 'Clear Plan'}</button><button data-modal="cancel-plan">Cancel</button></div>`,
    );
  } else if (a === 'clear') {
    filters = emptyFilters();
    syncUrl();
    render();
    document.querySelector('[data-action="clear"]')?.focus();
  } else if (a === 'clear-sponsors') {
    sponsorFilters.levels = [];
    sponsorFilters.categories = [];
    $('#sponsor-search').value = '';
    document.querySelectorAll('[data-sponsor-filter]').forEach((input) => {
      input.checked = false;
    });
    updateSponsors();
  } else if (a === 'filters') {
    filterOpen = !filterOpen;
    render();
    document.querySelector('[data-action="filters"]')?.focus();
  } else if (a === 'expand-grid') {
    gridExpanded = !gridExpanded;
    render();
    document.querySelector('[data-action="expand-grid"]')?.focus();
  } else if (a === 'import-snapshot') {
    try {
      const next = restoreState(e.target.closest('[data-action]').dataset.code);
      openImport();
      preview(next);
    } catch (err) {
      notify(err.message);
    }
  } else if (a === 'print') printSchedule();
  else if (a === 'calendar') calendarModal();
});
$('#main').addEventListener('change', (e) => {
  if (e.target.id === 'filter-slides') {
    filters.slides = e.target.checked;
    syncUrl();
    render();
    $('#filter-slides')?.focus();
  } else if (e.target.id === 'timezone' && e.target.value) {
    state.timezone = e.target.value;
    save();
    render();
    $('#timezone')?.focus();
  } else if (e.target.dataset.facet) {
    const name = e.target.dataset.facet,
      value = e.target.value;
    filters[name] = e.target.checked
      ? [...filters[name], value]
      : filters[name].filter((x) => x !== value);
    syncUrl();
    render();
    [...document.querySelectorAll('[data-facet]')]
      .find((x) => x.dataset.facet === name && x.value === value)
      ?.focus();
  } else if (e.target.dataset.sponsorFilter) {
    const name = e.target.dataset.sponsorFilter;
    sponsorFilters[name] = e.target.checked
      ? [...sponsorFilters[name], e.target.value]
      : sponsorFilters[name].filter((value) => value !== e.target.value);
    updateSponsors();
  }
});
$('#main').addEventListener('input', (e) => {
  if (e.target.id === 'filter-search') {
    filters.search = e.target.value;
    let pos = e.target.selectionStart;
    syncUrl();
    render();
    let input = $('#filter-search');
    input.focus();
    input.setSelectionRange(pos, pos);
  }
  if (e.target.id === 'speaker-search') {
    let q = e.target.value.toLowerCase(),
      count = 0;
    document.querySelectorAll('[data-name]').forEach((el) => {
      el.hidden = !fuzzyMatch(q, el.dataset.name);
      if (!el.hidden) count++;
    });
    $('#speaker-count').textContent =
      `${count} ${count === 1 ? 'speaker' : 'speakers'}`;
    announceResults($('#speaker-count').textContent);
  }
  if (e.target.id === 'sponsor-search') updateSponsors();
});
function scrollToNow() {
  const now = new Date(),
    today = day(now);
  const target = sessionAtNow(
    filtered().filter((s) => day(s.start) === today),
    now.getTime(),
  );
  if (!target) {
    notify('No sessions today match the current schedule and filters.');
    return;
  }
  dayOverrides.set(today, true);
  const restoreButton = document.activeElement?.dataset.action === 'now';
  if (state.view === 'grid') {
    render();
    if (restoreButton)
      document
        .querySelector('[data-action="now"]')
        ?.focus({ preventScroll: true });
  }
  const section = [
    ...document.querySelectorAll('.schedule-results .day-section'),
  ].find((el) => el.dataset.day === today);
  if (!section) return;
  section.open = true;
  const event = [...section.querySelectorAll('[data-session]')].find(
    (el) => el.dataset.session === target.id,
  );
  if (state.view === 'grid') {
    const wrap = section.querySelector('.grid-wrap');
    const destination = section.querySelector('[data-now]') || event;
    if (wrap && destination) {
      wrap.scrollTop = Math.max(
        0,
        destination.offsetTop -
          section.querySelector('.grid-head').offsetHeight -
          12,
      );
      section.scrollIntoView({ block: 'start' });
    }
  } else event?.scrollIntoView({ block: 'start', inline: 'nearest' });
}
function printSchedule() {
  const old = state.view,
    overrides = [...dayOverrides],
    restoreFocus = document.activeElement?.dataset.action === 'print';
  printingSchedule = true;
  state.view = 'expanded';
  render();
  window.addEventListener(
    'afterprint',
    () => {
      state.view = old;
      printingSchedule = false;
      dayOverrides.clear();
      overrides.forEach(([d, open]) => dayOverrides.set(d, open));
      render();
      if (restoreFocus) document.querySelector('[data-action=print]')?.focus();
    },
    { once: true },
  );
  window.print();
}
$('#import-button').onclick = openImport;
$('#export-button').onclick = openExport;
$('#calendar-button').onclick = calendarModal;
$('#print-button').onclick = printSchedule;
$('#share-button').onclick = () => {
  try {
    const page = location.hash.slice(2).split('?')[0].split('/');
    const code =
      page[0] === 'snapshot'
        ? page[1]
        : encodeState(activeState(), dictionary, 2);
    restoreState(code);
    const link = new URL(location.href);
    link.hash = '/snapshot/' + code;
    showModal(
      'Share Snapshot',
      `<p>This link is a read-only snapshot of your saved schedule. Anyone with the link can view it. Later changes create a different snapshot.</p><label for="share-link">Snapshot Link</label><textarea id="share-link" readonly>${esc(link.href)}</textarea><label for="snapshot-id">Snapshot ID</label><textarea id="snapshot-id" readonly>${esc(code)}</textarea><div class="actions"><button data-modal="copy-link">Copy Link</button><button data-modal="copy-id">Copy ID</button></div>`,
    );
  } catch (e) {
    notify(e.message);
  }
};
$('#close-modal').onclick = () => $('#modal').close();
document.querySelector('.skip').addEventListener('click', (e) => {
  e.preventDefault();
  $('#main').focus();
});
$('#modal').addEventListener('click', async (e) => {
  const saveEl = e.target.closest('[data-save]');
  if (saveEl && overlaySession) {
    const id = overlaySession.id;
    toggleSaved(id);
    overlayDirty = true;
    $('#modal-content').innerHTML =
      `${sessionContent(overlaySession)}<p><a href="${url(overlaySession)}">Open event page</a></p>`;
    $('#modal-content [data-save]')?.focus();
    return;
  }
  const a = e.target.dataset.modal;
  if (!a) return;
  try {
    if (a === 'confirm-restore-plan' || a === 'confirm-empty-plan') {
      if (!savePlan(a === 'confirm-restore-plan' ? [...preset] : [])) return;
      $('#modal').close();
      render();
      notify(
        a === 'confirm-restore-plan'
          ? 'Original plan restored.'
          : 'Jay’s Plan cleared.',
      );
    } else if (a === 'cancel-plan') {
      $('#modal').close();
    } else if (a === 'copy-link') {
      await navigator.clipboard.writeText($('#share-link').value);
      notify('Link copied');
    } else if (a === 'copy-id') {
      await navigator.clipboard.writeText($('#snapshot-id').value);
      notify('Snapshot ID copied');
    } else if (a === 'copy') {
      await navigator.clipboard.writeText($('#recovery').value);
      notify('Recovery code copied');
    } else if (a === 'preview-code') {
      pending = null;
      $('#import-preview').innerHTML = '';
      preview(restoreState(recoveryCode($('#recovery').value)));
    } else if (a === 'export')
      download(
        'kubecal-2026-backup.json',
        JSON.stringify(
          { version: 1, event: 'kubecon-na-2026', state: activeState() },
          null,
          2,
        ),
        'application/json',
      );
    else if (a === 'replace' || a === 'merge') {
      if (!pending) throw Error('Nothing to import');
      if (scheduleChoice === 'jay') {
        const next =
          a === 'replace'
            ? pending.selected
            : uniq([...jaysPlan, ...pending.selected]);
        if (!savePlan(next)) return;
      } else {
        state =
          a === 'replace'
            ? pending
            : {
                ...state,
                selected: uniq([...state.selected, ...pending.selected]),
              };
        save();
      }
      pending = null;
      $('#modal').close();
      render();
      notify('Schedule restored');
    } else if (a === 'ics-current' || a === 'ics-all') {
      download(
        'kubecon-na-2026.ics',
        calendar(a === 'ics-all' ? sessions : filtered()),
        'text/calendar;charset=utf-8',
      );
      $('#modal').close();
    }
  } catch (err) {
    notify(err.message || 'Unable to complete this action');
  }
});
$('#modal').addEventListener('change', async (e) => {
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  pending = null;
  $('#import-preview').innerHTML = '';
  try {
    if (e.target.files[0].size > 1000000)
      throw Error('Backup file is too large.');
    let x = JSON.parse(await e.target.files[0].text());
    if (x.version !== 1 || x.event !== 'kubecon-na-2026')
      throw Error('This is not a supported KubeCon 2026 backup.');
    preview(x.state);
  } catch (err) {
    notify(err.message || 'Could not read backup');
  }
});
$('#modal').addEventListener('close', () => {
  if (!overlaySession) return;
  const id = overlaySession.id;
  overlaySession = null;
  if (!overlayDirty) return;
  overlayDirty = false;
  const page = location.hash.slice(2).split('?')[0];
  if (page && page !== 'search') return;
  const y = window.scrollY;
  const grids = [...document.querySelectorAll('.grid-wrap')].map(
    (el) => el.scrollLeft,
  );
  render();
  document.querySelectorAll('.grid-wrap').forEach((el, i) => {
    el.scrollLeft = grids[i] || 0;
  });
  window.scrollTo(0, y);
  const link = [
    ...document.querySelectorAll('[data-session] a[href^="#/session/"]'),
  ].find((el) => el.closest('[data-session]').dataset.session === id);
  (link || document.querySelector('[data-action=mine]'))?.focus({
    preventScroll: true,
  });
});
window.addEventListener('hashchange', () => {
  if (overlaySession) $('#modal').close();
  headerFilterOpen = false;
  closeHeaderMenu();
  if (
    !location.hash.slice(2).split('?')[0] ||
    location.hash.startsWith('#/search')
  )
    readUrl();
  if (location.hash.startsWith('#/search')) filterOpen = true;
  render();
  window.scrollTo(0, 0);
  $('#main').focus({ preventScroll: true });
  updateHeader();
});
window.addEventListener('storage', (e) => {
  if (e.key === key && e.newValue) {
    try {
      let next = JSON.parse(e.newValue);
      validate(next);
      state = next;
      render();
    } catch {
      notify('Could not read changes from another tab.');
    }
  }
});
function closeHeaderMenu() {
  $('#header-menu').classList.remove('open');
  $('#header-menu').inert = true;
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  $('#menu-toggle').setAttribute('aria-label', 'Open menu');
}
function updateHeader() {
  const toolbar = document.querySelector('.layout > .toolbar');
  const sidebar = $('#filters-panel');
  const header = document.querySelector('.top');
  const rowBottom = header.firstElementChild.getBoundingClientRect().bottom;
  const controls = $('#header-controls');
  const shortcutsNeeded =
    !!toolbar && toolbar.getBoundingClientRect().bottom <= rowBottom;
  controls.hidden = !toolbar || (!mine && !shortcutsNeeded);
  controls.classList.toggle('mine-only', !!toolbar && mine && !shortcutsNeeded);
  document.querySelector('.header-views-label').hidden = !shortcutsNeeded;
  document.querySelector('.header-views').hidden = !shortcutsNeeded;
  $('#header-mine').setAttribute(
    'aria-label',
    mine
      ? 'Show Event Schedule'
      : `Show My Schedule (${state.selected.length})`,
  );
  $('#header-mine').title = mine
    ? 'Show Event Schedule'
    : `Show My Schedule (${state.selected.length})`;
  $('#header-mine').setAttribute('aria-pressed', String(mine));
  document
    .querySelectorAll('[data-header-view]')
    .forEach((button) =>
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.headerView === state.view),
      ),
    );
  $('#header-now').hidden = !shortcutsNeeded;
  $('#header-grid-width').hidden = !shortcutsNeeded || state.view !== 'grid';
  $('#header-grid-width').setAttribute('aria-pressed', String(gridExpanded));
  document.documentElement.style.setProperty(
    '--header-height',
    `${header.getBoundingClientRect().height}px`,
  );
  if (sidebar) sidebar.classList.toggle('header-panel', headerFilterOpen);
  const rect = sidebar?.getBoundingClientRect();
  const visible =
    sidebar &&
    getComputedStyle(sidebar).display !== 'none' &&
    rect.bottom > header.getBoundingClientRect().bottom &&
    rect.top < innerHeight;
  const filterButton = $('#header-filter');
  filterButton.hidden = !toolbar || (!headerFilterOpen && visible);
  filterButton.setAttribute('aria-expanded', String(headerFilterOpen));
  const count =
    (filters.search ? 1 : 0) +
    (filters.slides ? 1 : 0) +
    ['date', 'venue', 'type', 'level'].reduce(
      (n, key) => n + filters[key].length,
      0,
    );
  filterButton.setAttribute(
    'aria-label',
    `Filters${count ? ` (${count} active)` : ''}`,
  );
  filterButton.title = `Filters${count ? ` (${count} active)` : ''}`;
  $('#header-filter-count').hidden = !count;
  $('#header-filter-count').textContent = count;
}
$('#header-filter').addEventListener('click', () => {
  headerFilterOpen = !headerFilterOpen;
  updateHeader();
  if (headerFilterOpen) $('#filter-search')?.focus();
});
$('#header-now').addEventListener('click', scrollToNow);
$('#header-mine').addEventListener('click', () => {
  mine = !mine;
  chooseSchedule(mine ? 'mine' : 'all');
  render();
  $('#header-mine').focus();
});
document.querySelector('.header-views').addEventListener('click', (e) => {
  const button = e.target.closest('[data-header-view]');
  if (!button) return;
  state.view = button.dataset.headerView;
  save();
  syncUrl();
  render();
  button.focus();
});
$('#header-grid-width').addEventListener('click', () => {
  gridExpanded = !gridExpanded;
  render();
  $('#header-grid-width').focus();
});
$('#menu-toggle').addEventListener('click', () => {
  const open = $('#header-menu').classList.toggle('open');
  $('#header-menu').inert = !open;
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
  $('#menu-toggle').setAttribute(
    'aria-label',
    open ? 'Close menu' : 'Open menu',
  );
});
document.addEventListener('click', (e) => {
  const link = e.target.closest(
    '.main-nav a[href="#/"], .mobile-nav a[href="#/"]',
  );
  if (link && (!location.hash || location.hash === '#/')) {
    e.preventDefault();
    window.scrollTo(0, 0);
    updateHeader();
  }
  if (!e.target.closest('#header-menu, #menu-toggle')) closeHeaderMenu();
  else if (e.target.closest('#header-menu a, #header-menu button'))
    closeHeaderMenu();
});
document.addEventListener('pointerdown', (e) => {
  document.querySelectorAll('.sponsor-facet[open]').forEach((facet) => {
    if (!facet.contains(e.target)) facet.open = false;
  });
  if (headerFilterOpen && !e.target.closest('#filters-panel, #header-filter')) {
    headerFilterOpen = false;
    updateHeader();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (headerFilterOpen) {
    headerFilterOpen = false;
    updateHeader();
    $('#header-filter').focus();
  }
  if ($('#header-menu').classList.contains('open')) {
    closeHeaderMenu();
    $('#menu-toggle').focus();
  }
});
window.addEventListener('scroll', updateHeader, { passive: true });
window.addEventListener('resize', updateHeader);
readUrl();
if (location.hash.startsWith('#/search')) filterOpen = true;
render();
