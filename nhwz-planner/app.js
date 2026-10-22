'use strict';

const STORAGE_KEY = 'nhwz.saved.v1';
const BUILD = 'demo-2026-10-22';

const state = {
  data: null,
  eventsById: new Map(),
  day: null,
  applied: { campus: new Set(), category: new Set(), language: new Set() },
  draft: { campus: new Set(), category: new Set(), language: new Set() },
  saved: new Set(),
  storageOk: true,
  view: 'programme',
  lastList: { day: null, scroll: 0 },
  lastFocus: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- storage ---------- */
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === 'string'));
  } catch (e) {
    return new Set();
  }
}

function persistSaved() {
  if (!state.storageOk) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(state.saved)));
  } catch (e) {
    state.storageOk = false;
    toast('Saves will not persist after closing this tab.');
  }
}

function detectStorage() {
  try {
    const k = '__nhwz_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- helpers ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function safeUrl(u) {
  if (!u || typeof u !== 'string') return null;
  try {
    const url = new URL(u, location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch (e) { /* ignore */ }
  return null;
}

const LANG_LABEL = { en: 'English', de: 'German', both: 'German & English' };

function langMatches(eventLang, selected) {
  if (selected.size === 0) return true;
  const wantsEn = selected.has('en');
  const wantsDe = selected.has('de');
  if (wantsEn && wantsDe) {
    return eventLang === 'en' || eventLang === 'de' || eventLang === 'both';
  }
  if (wantsEn) return eventLang === 'en' || eventLang === 'both';
  if (wantsDe) return eventLang === 'de' || eventLang === 'both';
  return true;
}

function dayEvents(dayId) {
  return state.data.events
    .filter((e) => e.day === dayId)
    .sort((a, b) => {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return a.title.localeCompare(b.title, 'en');
    });
}

function matchesFilters(e, f) {
  if (f.campus.size && !f.campus.has(e.campus)) return false;
  if (f.category.size && !f.category.has(e.category)) return false;
  if (!langMatches(e.language, f.language)) return false;
  return true;
}

function visibleEvents() {
  return dayEvents(state.day).filter((e) => matchesFilters(e, state.applied));
}

function appliedCount() {
  return state.applied.campus.size + state.applied.category.size + state.applied.language.size;
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------- rendering: days ---------- */
function renderDays() {
  const box = $('#dayTabs');
  box.innerHTML = '';
  state.data.days.forEach((d) => {
    const b = document.createElement('button');
    b.className = 'day' + (d.id === state.day ? ' is-active' : '');
    b.type = 'button';
    b.textContent = d.short;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', d.id === state.day ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (state.day === d.id) return;
      state.day = d.id;
      renderDays();
      renderProgramme();
    });
    box.appendChild(b);
  });
}

/* ---------- rendering: cards ---------- */
function cardHTML(e) {
  const saved = state.saved.has(e.id);
  const cancelled = e.status === 'cancelled';
  const time = e.end ? `${e.start}–${e.end}` : e.start;
  return `
    <li>
      <article class="card${cancelled ? ' is-cancelled' : ''}">
        <div class="card-top">
          <div>
            <p class="card-time">${esc(time)}</p>
            <h3 class="card-title">${esc(e.title)}</h3>
          </div>
          <button class="save" type="button"
            data-save="${esc(e.id)}"
            aria-pressed="${saved ? 'true' : 'false'}"
            aria-label="${saved ? 'Remove from My Week' : 'Save to My Week'}: ${esc(e.title)}">
            ${saved ? '\u2605' : '\u2606'}
          </button>
        </div>
        <p class="card-meta">${esc(e.venue)} · ${esc(e.campus)}</p>
        <div class="card-tags">
          <span class="tag">${esc(e.category)}</span>
          <span class="tag">${esc(LANG_LABEL[e.language] || e.language)}</span>
          ${cancelled ? '<span class="tag tag-cancel">Cancelled</span>' : ''}
        </div>
        <div class="card-actions">
          <button class="link-btn" type="button" data-details="${esc(e.id)}">View details</button>
        </div>
      </article>
    </li>`;
}

function renderProgramme() {
  const list = visibleEvents();
  const ul = $('#eventList');
  const empty = $('#emptyProgramme');
  const count = $('#resultCount');

  count.textContent = list.length === 1 ? '1 event' : `${list.length} events`;

  ul.innerHTML = list.map(cardHTML).join('');

  if (list.length === 0) {
    empty.hidden = false;
    empty.textContent = appliedCount()
      ? 'No events match these filters. Try clearing one.'
      : 'No events scheduled for this day.';
    ul.hidden = true;
  } else {
    empty.hidden = true;
    ul.hidden = false;
  }

  renderChips();
  const n = appliedCount();
  const badge = $('#filterCount');
  badge.hidden = n === 0;
  badge.textContent = n;
  $('#btnClearAll').hidden = n === 0;
}

/* ---------- rendering: chips ---------- */
function renderChips() {
  const box = $('#activeChips');
  box.innerHTML = '';
  const groups = [
    ['campus', state.data.campuses],
    ['category', state.data.categories],
    ['language', ['en', 'de']],
  ];
  groups.forEach(([group, values]) => {
    values.forEach((v) => {
      if (!state.applied[group].has(v)) return;
      const label = group === 'language' ? LANG_LABEL[v] : v;
      const el = document.createElement('span');
      el.className = 'chip';
      el.innerHTML = `${esc(label)}<button type="button" aria-label="Remove filter ${esc(label)}" data-chip="${esc(group)}:${esc(v)}">\u00d7</button>`;
      box.appendChild(el);
    });
  });
}

/* ---------- rendering: My Week ---------- */
function renderMyWeek() {
  const body = $('#myWeekBody');
  const savedEvents = state.data.events.filter((e) => state.saved.has(e.id));

  if (savedEvents.length === 0) {
    body.innerHTML = `
      <div class="empty">
        <p style="margin:0 0 12px">Nothing saved yet.</p>
        <button class="btn btn-primary" type="button" id="btnBrowse">Browse programme</button>
      </div>`;
    $('#btnBrowse').addEventListener('click', () => switchView('programme'));
    return;
  }

  const byDay = new Map();
  savedEvents.forEach((e) => {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  });

  const orderedDays = state.data.days.filter((d) => byDay.has(d.id));
  let html = '';
  orderedDays.forEach((d) => {
    const evs = byDay.get(d.id).sort((a, b) => {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return a.title.localeCompare(b.title, 'en');
    });
    html += `<section class="week-day"><h3>${esc(d.long)}</h3><ul class="event-list">`;
    html += evs.map(cardHTML).join('');
    html += '</ul></section>';
  });
  body.innerHTML = html;
}

/* ---------- rendering: details ---------- */
function renderDetails(id) {
  const e = state.eventsById.get(id);
  const box = $('#detailsBody');
  if (!e) {
    box.innerHTML = '<p class="empty">Event not found.</p>';
    return;
  }

  const saved = state.saved.has(e.id);
  const cancelled = e.status === 'cancelled';
  const time = e.end ? `${e.start}–${e.end}` : e.start;
  const dayObj = state.data.days.find((d) => d.id === e.day);
  const mapUrl = safeUrl(e.mapUrl);
  const regUrl = safeUrl(e.registrationUrl);

  let regBlock;
  if (cancelled) {
    regBlock = '<div class="notice notice-danger">Registration is unavailable — this event has been cancelled.</div>';
  } else if (regUrl && !e.historicalRegistration) {
    regBlock = `<p style="margin:16px 0 0"><a class="btn btn-primary" href="${esc(regUrl)}" target="_blank" rel="noopener noreferrer">Register (opens in new tab)</a></p>`;
  } else if (regUrl && e.historicalRegistration) {
    regBlock = '<div class="notice">Registration link from a previous year is not shown. Contact the organiser for the current form.</div>';
  } else if (e.registrationRequired) {
    regBlock = '<div class="notice">Registration details were not supplied. Contact the organiser.</div>';
  } else {
    regBlock = '<div class="notice">No registration needed — just turn up.</div>';
  }

  let mapBlock;
  if (mapUrl) {
    mapBlock = `<a href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps (opens in new tab)</a>`;
  } else {
    mapBlock = '<span style="color:var(--ink-soft)">Location details were not supplied for this event.</span>';
  }

  box.innerHTML = `
    <header class="details-head">
      <h2>${esc(e.title)}</h2>
      ${cancelled ? '<span class="tag tag-cancel">Cancelled</span>' : ''}
    </header>
    <p class="details-time">${esc(dayObj ? dayObj.long : e.day)} · ${esc(time)}</p>
    <div class="card-tags">
      <span class="tag">${esc(e.category)}</span>
      <span class="tag">${esc(LANG_LABEL[e.language] || e.language)}</span>
    </div>
    <p class="details-desc">${esc(e.description)}</p>
    <dl class="details-list">
      <li><span class="k">Venue</span><span class="v">${esc(e.venue)}</span></li>
      <li><span class="k">Campus</span><span class="v">${esc(e.campus)}</span></li>
      <li><span class="k">Address</span><span class="v">${e.address ? esc(e.address) : 'Not supplied'}</span></li>
      <li><span class="k">Map</span><span class="v">${mapBlock}</span></li>
    </dl>
    ${regBlock}
    <p style="margin:20px 0 0">
      <button class="btn ${saved ? 'btn-primary' : 'btn-ghost'}" type="button" data-save="${esc(e.id)}" aria-pressed="${saved ? 'true' : 'false'}">
        ${saved ? 'Saved \u2014 remove from My Week' : 'Save to My Week'}
      </button>
    </p>`;
}

/* ---------- panel ---------- */
function buildPanel() {
  const body = $('#panelBody');
  body.innerHTML = '';
  const groups = [
    ['campus', 'Campus', state.data.campuses],
    ['category', 'Category', state.data.categories],
    ['language', 'Language', ['en', 'de']],
  ];
  groups.forEach(([key, label, values]) => {
    const sec = document.createElement('div');
    sec.className = 'fgroup';
    sec.innerHTML = `<h3>${esc(label)}</h3>`;
    values.forEach((v) => {
      const id = `f-${key}-${v.replace(/\s+/g, '-').toLowerCase()}`;
      const row = document.createElement('label');
      row.className = 'fopt';
      row.setAttribute('for', id);
      const text = key === 'language' ? LANG_LABEL[v] : v;
      row.innerHTML = `<input type="checkbox" id="${esc(id)}" data-group="${esc(key)}" value="${esc(v)}" ${state.draft[key].has(v) ? 'checked' : ''}><span>${esc(text)}</span>`;
      sec.appendChild(row);
    });
    body.appendChild(sec);
  });

  $$('input[type=checkbox]', body).forEach((cb) => {
    cb.addEventListener('change', () => {
      const g = cb.dataset.group;
      if (cb.checked) state.draft[g].add(cb.value);
      else state.draft[g].delete(cb.value);
    });
  });
}

function openPanel() {
  state.lastFocus = document.activeElement;
  state.draft = {
    campus: new Set(state.applied.campus),
    category: new Set(state.applied.category),
    language: new Set(state.applied.language),
  };
  buildPanel();
  $('#filterPanel').hidden = false;
  $('#backdrop').hidden = false;
  $('#btnFilters').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  $('#btnPanelClose').focus();
}

function closePanel(refocus = true) {
  $('#filterPanel').hidden = true;
  $('#backdrop').hidden = true;
  $('#btnFilters').setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  if (refocus && state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
}

function applyFilters() {
  state.applied = {
    campus: new Set(state.draft.campus),
    category: new Set(state.draft.category),
    language: new Set(state.draft.language),
  };
  closePanel();
  renderProgramme();
}

/* ---------- view switching ---------- */
function switchView(view, opts = {}) {
  if (view === state.view && !opts.force) {
    if (view === 'myweek') renderMyWeek();
    return;
  }
  state.view = view;
  ['programme', 'myweek', 'details'].forEach((v) => {
    const sec = $(`#view-${v}`);
    if (sec) sec.hidden = v !== view;
  });
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle('is-active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (view === 'myweek') renderMyWeek();
  if (view === 'programme' && state.lastList.day === state.day && state.lastList.scroll > 0) {
    requestAnimationFrame(() => window.scrollTo(0, state.lastList.scroll));
  }
}

function openDetails(id) {
  state.lastList = { day: state.day, scroll: window.scrollY };
  renderDetails(id);
  switchView('details', { force: true });
  window.scrollTo(0, 0);
  $('#btnBack').focus();
}

/* ---------- events ---------- */
function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
  persistSaved();
  syncSaveButtons(id);
  updateSaveCount();
  if (state.view === 'myweek') renderMyWeek();
}

function syncSaveButtons(id) {
  const saved = state.saved.has(id);
  $$(`[data-save="${CSS.escape(id)}"]`).forEach((btn) => {
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    if (btn.classList.contains('save')) {
      btn.textContent = saved ? '\u2605' : '\u2606';
      btn.setAttribute('aria-label', (saved ? 'Remove from My Week' : 'Save to My Week') + ': ' + (state.eventsById.get(id) || {}).title || '');
    } else {
      btn.textContent = saved ? 'Saved \u2014 remove from My Week' : 'Save to My Week';
      btn.classList.toggle('btn-primary', saved);
      btn.classList.toggle('btn-ghost', !saved);
    }
  });
}

function updateSaveCount() {
  const badge = $('#saveCount');
  const n = state.saved.size;
  badge.hidden = n === 0;
  badge.textContent = n;
}

function wireDelegation() {
  document.addEventListener('click', (ev) => {
    const saveBtn = ev.target.closest('[data-save]');
    if (saveBtn) {
      ev.preventDefault();
      toggleSave(saveBtn.dataset.save);
      return;
    }
    const detailBtn = ev.target.closest('[data-details]');
    if (detailBtn) {
      ev.preventDefault();
      openDetails(detailBtn.dataset.details);
      return;
    }
    const chipBtn = ev.target.closest('[data-chip]');
    if (chipBtn) {
      ev.preventDefault();
      const [group, value] = chipBtn.dataset.chip.split(':');
      state.applied[group].delete(value);
      renderProgramme();
    }
  });
}

/* ---------- init ---------- */
function init() {
  state.storageOk = detectStorage();
  state.saved = loadSaved();

  window.addEventListener('storage', (ev) => {
    if (ev.key !== STORAGE_KEY) return;
    state.saved = loadSaved();
    updateSaveCount();
    Array.from(state.eventsById.keys()).forEach(syncSaveButtons);
    if (state.view === 'myweek') renderMyWeek();
  });

  fetch('data/events.json')
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((data) => {
      state.data = data;
      state.eventsById = new Map(data.events.map((e) => [e.id, e]));

      const known = new Set(data.events.map((e) => e.id));
      state.saved = new Set(Array.from(state.saved).filter((id) => known.has(id)));

      state.day = data.days[0].id;
      $('#buildStamp').textContent = 'build ' + BUILD;

      renderDays();
      renderProgramme();
      updateSaveCount();
      wireDelegation();

      $('#btnFilters').addEventListener('click', openPanel);
      $('#btnPanelClose').addEventListener('click', () => closePanel());
      $('#backdrop').addEventListener('click', () => closePanel());
      $('#btnShowResults').addEventListener('click', applyFilters);
      $('#btnClearDraft').addEventListener('click', () => {
        state.draft = { campus: new Set(), category: new Set(), language: new Set() };
        buildPanel();
      });
      $('#btnClearAll').addEventListener('click', () => {
        state.applied = { campus: new Set(), category: new Set(), language: new Set() };
        renderProgramme();
      });
      $('#btnBack').addEventListener('click', () => {
        switchView('programme');
        requestAnimationFrame(() => window.scrollTo(0, state.lastList.scroll || 0));
      });
      $$('.tab').forEach((t) => {
        t.addEventListener('click', () => switchView(t.dataset.view));
      });

      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && !$('#filterPanel').hidden) {
          closePanel();
        }
      });

      if (!state.storageOk) {
        toast('Storage unavailable — saves last only for this session.');
      }
    })
    .catch((err) => {
      $('#resultCount').textContent = 'Could not load events';
      const empty = $('#emptyProgramme');
      empty.hidden = false;
      empty.textContent = 'The event data could not be loaded (' + err.message + ').';
    });
}

document.addEventListener('DOMContentLoaded', init);
