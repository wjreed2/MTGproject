// Playgroups — named member groups. Members see each other's private decks in
// the game-tracker deck picker; the New Game player list scopes to co-members.
// Owner manages membership; any member can leave. Server: /api/playgroups.
// Uses the shared db-client wrappers (apiFetch/apiPostJson/apiDelete).

// PLAYER_COLORS / nextFreePlayerColor live in js/games.js — it is bundled first.

let _playgroups = [];      // [{id, name, ownerId, isOwner, members:[{id,name}]}] — ids normalized to Number
let _pgAllUsers = null;    // [{id, name}] cached for the add-member picker (fetched once per session)

function _pgNormalize(groups) {
  return (Array.isArray(groups) ? groups : []).map(g => ({
    ...g,
    id: Number(g.id),
    ownerId: Number(g.ownerId),
    // Spread rather than list fields: this rebuilt each member from three named
    // keys and silently dropped `color`, so a saved colour was discarded on
    // every load and the member fell back to their palette slot.
    members: (g.members || []).map(m => ({ ...m, id: Number(m.id), name: m.name, status: m.status || 'accepted' })),
  }));
}

async function loadPlaygroupsPanel() {
  const host = document.getElementById('playgroupsPanel');
  if (!host) return;
  if (!host.childElementCount) host.innerHTML = '<div class="pg-empty">Loading…</div>';
  try {
    const [data, users] = await Promise.all([
      apiFetch('/playgroups'),
      _pgAllUsers ? Promise.resolve(_pgAllUsers) : apiFetch('/users'),
    ]);
    _playgroups = _pgNormalize(data.playgroups);
    _pgAllUsers = (Array.isArray(users) ? users : []).map(u => ({ id: Number(u.id), name: u.name }));
  } catch (e) {
    host.innerHTML = `<div class="pg-empty" style="color:var(--red)">${escapeHtml(e.message)}</div>`;
    return;
  }
  renderPlaygroupsPanel();
}

/** Refetch groups only (users list is session-cached) and repaint. */
async function _pgReload() {
  try {
    const data = await apiFetch('/playgroups');
    _playgroups = _pgNormalize(data.playgroups);
    renderPlaygroupsPanel();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

// Cards are a fixed height so the grid stays even regardless of roster size;
// anything past PG_PEEK members lives behind the card's own expand toggle.
const PG_PEEK = 3;
const _pgExpanded = new Set();

function togglePlaygroupExpand(groupId) {
  const id = Number(groupId);
  if (_pgExpanded.has(id)) _pgExpanded.delete(id); else _pgExpanded.add(id);
  renderPlaygroupsPanel();
}

// Same card grid as the Games tab next door, so the two panes read as one page.
function renderPlaygroupsPanel() {
  const host = document.getElementById('playgroupsPanel');
  if (!host) return;
  if (!_playgroups.length) {
    host.innerHTML = `<div class="pg-empty">
      No playgroups yet. Create one and add your group — members can pick each
      other's decks (including private ones) when starting a game.</div>`;
    return;
  }
  const myId = (typeof currentUser !== 'undefined' && currentUser?.id != null) ? Number(currentUser.id) : null;
  const x = typeof gameIcon === 'function' ? gameIcon('x', 11) : '&times;';
  host.innerHTML = `<div class="pg-grid">${_playgroups.map(g => {
    const open = _pgExpanded.has(Number(g.id));
    const selfInvited = g.members.some(m => myId != null && m.id === myId && m.status === 'invited');
    const shown = open ? g.members : g.members.slice(0, PG_PEEK);
    const hidden = g.members.length - shown.length;
    // Owner / invited read as plain text, not pills, and the per-member remove
    // button is off for now — removePlaygroupMember is still wired up for when
    // it comes back.
    const memberRows = shown.map(m => {
      const isSelf = myId != null && m.id === myId;
      const tags = (m.id === g.ownerId ? '<span class="pg-tag pg-tag-owner">owner</span>' : '')
        + (m.status === 'invited' ? '<span class="pg-tag">invited</span>' : '');
      // The name wears the colour, because that is what the colour is for.
      const color = m.color || _pgFallbackColor(g, m.id);
      const canEdit = g.isOwner || isSelf;
      const swatch = canEdit
        ? `<button type="button" class="pg-swatch" style="--sw:${escapeHtml(color)}"
             title="Pick ${escapeHtml(m.name || 'this player')}'s colour"
             onclick="pgOpenColorPicker(${g.id}, ${m.id}, this)"></button>`
        : `<span class="pg-swatch is-static" style="--sw:${escapeHtml(color)}"></span>`;
      return `<div class="pg-member">
        ${swatch}
        <span class="pg-member-name" style="color:${escapeHtml(color)}">${escapeHtml(m.name || '')}${isSelf ? ' <span class="pg-you">(you)</span>' : ''}</span>
        ${tags}
      </div>`;
    }).join('');
    // The slot is always rendered — an inert placeholder when there is nothing
    // to expand — so a card with a toggle is exactly as tall as one without.
    const expandRow = (hidden > 0 || open)
      ? `<button class="btn btn-outline btn-sm pg-expand" aria-expanded="${open}" onclick="togglePlaygroupExpand(${g.id})">${open ? 'Show fewer' : `Show all ${g.members.length}`}</button>`
      : '<button class="btn btn-outline btn-sm pg-expand is-placeholder" tabindex="-1" aria-hidden="true">&nbsp;</button>';
    const acceptRow = selfInvited
      ? `<button class="btn btn-outline btn-sm pg-accept" onclick="acceptPlaygroupInvite(${g.id})">Accept invite</button>`
      : '';
    const addable = (_pgAllUsers || []).filter(u => !g.members.some(m => m.id === u.id));
    const addRow = g.isOwner && addable.length ? `
      <div class="pg-add-row">
        <select id="pgAddSel_${g.id}" class="pg-add-select" title="Add a member">
          <option value="" selected>Choose player…</option>
          ${addable.map(u => `<option value="${u.id}">${escapeHtml(u.name || '')}</option>`).join('')}
        </select>
        <button class="btn btn-outline btn-sm" onclick="addPlaygroupMember(${g.id})">Add</button>
      </div>` : '';
    return `<div class="pg-card${open ? ' is-open' : ''}">
      <div class="pg-card-head">
        <span class="pg-group-name">${escapeHtml(g.name || '')}</span>
        <span class="pg-count">${g.members.length} member${g.members.length === 1 ? '' : 's'}</span>
        <div style="flex:1"></div>
        ${g.isOwner ? `<button class="btn btn-ghost btn-sm btn-icon pg-x-btn" title="Delete playgroup" aria-label="Delete playgroup" onclick="deletePlaygroup(${g.id})">${x}</button>` : ''}
      </div>
      <div class="pg-members">${memberRows}</div>
      ${expandRow}
      <div style="flex:1"></div>
      ${acceptRow}
      ${addRow}
    </div>`;
  }).join('')}</div>`;
  if (typeof _glassSelectEnsure === 'function') _glassSelectEnsure();
}

/** A member with no colour set still shows one: their slot in the palette. */
function _pgFallbackColor(group, memberId) {
  const idx = (group.members || []).findIndex(m => Number(m.id) === Number(memberId));
  return PLAYER_COLORS[(idx < 0 ? 0 : idx) % PLAYER_COLORS.length];
}

/** Colour of a member in a group, or null when they are not in it. */
function playgroupMemberColor(groupId, memberId) {
  const g = _playgroups.find(x => Number(x.id) === Number(groupId));
  if (!g) return null;
  const m = (g.members || []).find(x => Number(x.id) === Number(memberId));
  if (!m) return null;
  return m.color || _pgFallbackColor(g, memberId);
}
globalThis.playgroupMemberColor = playgroupMemberColor;

function pgCloseColorPicker() {
  if (!document.querySelector('.pg-color-menu')) return;
  document.querySelectorAll('.pg-color-menu').forEach(m => m.remove());
  // Flush rather than drop: closing is not a cancel, and the colour is already
  // on screen by then.
  if (_pgCommitTimer && _pgPickCtx) {
    clearTimeout(_pgCommitTimer);
    const { groupId, memberId, h, s: sat, v } = _pgPickCtx;
    void pgSetMemberColor(groupId, memberId, _hsvToHex(h, sat, v), { silent: true });
  }
  _pgCommitTimer = null;
}

// ── Colour maths ────────────────────────────────────────────────────────────
function _hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  const to = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(seg[0])}${to(seg[1])}${to(seg[2])}`;
}

function _hexToHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { h: 210, s: 0.6, v: 0.9 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
}

/**
 * An in-app colour picker rather than the browser's.
 *
 * A native <input type="color"> reaches the whole spectrum but opens the
 * operating system's dialog, which is the one surface in this flow that cannot
 * be made to look like the rest of the app. This is the same capability drawn
 * in glass: a saturation/value field over the chosen hue, a hue rail under it,
 * the palette as presets, and the hex if you know what you want.
 */
let _pgPickCtx = null;   // { groupId, memberId, h, s, v }

function pgOpenColorPicker(groupId, memberId, btn) {
  if (typeof event !== 'undefined' && event) event.stopPropagation();
  const open = document.querySelector('.pg-color-menu');
  pgCloseColorPicker();
  if (open) return;

  const current = playgroupMemberColor(groupId, memberId) || PLAYER_COLORS[0];
  const { h, s: sat, v } = _hexToHsv(current);
  _pgPickCtx = { groupId, memberId, h, s: sat, v };

  const menu = document.createElement('div');
  menu.className = 'glass-menu pg-color-menu';
  menu.addEventListener('click', e => e.stopPropagation());
  menu.innerHTML = `
    <div class="pgc-field" id="pgcField">
      <div class="pgc-field-sat"></div>
      <div class="pgc-field-val"></div>
      <div class="pgc-cursor" id="pgcCursor"></div>
    </div>
    <div class="pgc-hue-wrap">
      <input type="range" class="pgc-hue" id="pgcHue" min="0" max="359" step="1" value="${Math.round(h)}" aria-label="Hue">
    </div>
    <div class="pgc-foot">
      <span class="pgc-preview" id="pgcPreview"></span>
      <input class="pgc-hex" id="pgcHex" maxlength="7" spellcheck="false" aria-label="Hex colour">
      <button type="button" class="btn btn-outline btn-sm pgc-apply" id="pgcApply">Done</button>
    </div>
    <div class="pgc-presets">${PLAYER_COLORS.map(c =>
      `<button type="button" class="pgc-preset" data-c="${c}" style="--sw:${c}" title="${c}"></button>`).join('')}</div>`;

  document.body.appendChild(menu);
  _pgPaintPicker();

  const field = menu.querySelector('#pgcField');
  const pickFromEvent = e => {
    const r = field.getBoundingClientRect();
    _pgPickCtx.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    _pgPickCtx.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    _pgPaintPicker();
  };
  field.addEventListener('pointerdown', e => {
    e.preventDefault();
    field.setPointerCapture(e.pointerId);   // keeps the drag alive outside the box
    pickFromEvent(e);
    _pgCommitPicker();
    const move = ev => pickFromEvent(ev);
    const up = () => {
      field.removeEventListener('pointermove', move);
      field.removeEventListener('pointerup', up);
      _pgCommitPicker();
    };
    field.addEventListener('pointermove', move);
    field.addEventListener('pointerup', up);
  });
  menu.querySelector('#pgcHue').addEventListener('input', e => {
    _pgPickCtx.h = Number(e.target.value) || 0;
    _pgPaintPicker();
    _pgCommitPicker();
  });
  menu.querySelector('#pgcHex').addEventListener('input', e => {
    const val = e.target.value.trim();
    if (!/^#?[0-9a-f]{6}$/i.test(val)) return;
    Object.assign(_pgPickCtx, _hexToHsv(val));
    _pgPaintPicker({ skipHex: true });
    _pgCommitPicker();
  });
  menu.querySelector('#pgcApply').addEventListener('click', () => {
    const hex = _hsvToHex(_pgPickCtx.h, _pgPickCtx.s, _pgPickCtx.v);
    clearTimeout(_pgCommitTimer);
    pgCloseColorPicker();
    void pgSetMemberColor(groupId, memberId, hex);
  });
  menu.querySelectorAll('.pgc-preset').forEach(b => b.addEventListener('click', () => {
    pgCloseColorPicker();
    void pgSetMemberColor(groupId, memberId, b.dataset.c);
  }));

  const r = btn.getBoundingClientRect();
  const margin = 8;
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  const below = window.innerHeight - r.bottom;
  const top = below >= mh + 10 ? r.bottom + 6 : Math.max(margin, r.top - mh - 6);
  menu.style.top = Math.min(top, window.innerHeight - mh - margin) + 'px';
  menu.style.left = Math.min(Math.max(margin, r.left), window.innerWidth - mw - margin) + 'px';
}

let _pgCommitTimer = null;
/**
 * Save the colour the picker is currently showing.
 *
 * Picking used to require pressing Set, and the live preview made it look
 * already applied — so dismissing the menu left the choice on screen, unsaved,
 * until a reload silently reverted it. Every gesture that settles on a colour
 * now commits it.
 */
function _pgCommitPicker() {
  if (!_pgPickCtx) return;
  const { groupId, memberId, h, s: sat, v } = _pgPickCtx;
  const hex = _hsvToHex(h, sat, v);
  clearTimeout(_pgCommitTimer);
  _pgCommitTimer = setTimeout(() => { void pgSetMemberColor(groupId, memberId, hex, { silent: true }); }, 220);
}

/** Repaint the picker from _pgPickCtx and preview the colour on the member. */
function _pgPaintPicker(opts = {}) {
  if (!_pgPickCtx) return;
  const { h, s: sat, v } = _pgPickCtx;
  const hex = _hsvToHex(h, sat, v);
  const menu = document.querySelector('.pg-color-menu');
  if (!menu) return;
  menu.style.setProperty('--pgc-hue', `hsl(${h} 100% 50%)`);
  menu.style.setProperty('--pgc-cur', hex);
  const cur = menu.querySelector('#pgcCursor');
  if (cur) { cur.style.left = `${sat * 100}%`; cur.style.top = `${(1 - v) * 100}%`; }
  const hexEl = menu.querySelector('#pgcHex');
  if (hexEl && !opts.skipHex) hexEl.value = hex;
  _pgPreviewMemberColor(_pgPickCtx.groupId, _pgPickCtx.memberId, hex);
}

/** Paint a colour without saving it, so dragging is visible on the member row. */
function _pgPreviewMemberColor(groupId, memberId, color) {
  const g = _playgroups.find(x => Number(x.id) === Number(groupId));
  const m = g && (g.members || []).find(x => Number(x.id) === Number(memberId));
  if (!m) return;
  m.color = color;
  const card = document.querySelectorAll('.pg-card')[_playgroups.indexOf(g)];
  const idx = (g.members || []).indexOf(m);
  const name = card?.querySelectorAll('.pg-member-name')[idx];
  const sw = card?.querySelectorAll('.pg-swatch')[idx];
  if (name) name.style.color = color;
  if (sw) sw.style.setProperty('--sw', color);
}

async function pgSetMemberColor(groupId, memberId, color, opts = {}) {
  const g = _playgroups.find(x => Number(x.id) === Number(groupId));
  const m = g && (g.members || []).find(x => Number(x.id) === Number(memberId));
  const previous = m ? m.color : null;
  if (m) {
    m.color = color;
    // Never repaint while the picker is open — renderPlaygroupsPanel() rebuilds
    // the member rows, and a mid-drag rebuild pulls the element out from under
    // the pointer. The preview has already painted the name and swatch.
    if (!opts.silent) renderPlaygroupsPanel();
  }
  try {
    const res = await fetch(`/api/playgroups/${groupId}/members/${memberId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ color }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'save failed');
    // A game freezes its seat colours at creation, so carry the change into any
    // that are still being played.
    if (typeof applyPlaygroupColorToLiveGames === 'function') {
      applyPlaygroupColorToLiveGames(groupId, memberId, color);
    }
  } catch (e) {
    if (m) { m.color = previous; renderPlaygroupsPanel(); }
    showNotif(e.message || 'Could not save colour', true);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', () => pgCloseColorPicker());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pgCloseColorPicker(); });
}

async function acceptPlaygroupInvite(groupId) {
  try {
    await apiPostJson(`/playgroups/${groupId}/members/accept`, {});
    await _pgReload();
    if (typeof showNotif === 'function') showNotif('Invite accepted — you can now pick each other\'s decks in games');
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

async function openCreatePlaygroup() {
  const name = typeof showPromptModal === 'function'
    ? await showPromptModal({ title: 'New playgroup', placeholder: 'Playgroup name', okLabel: 'Create' })
    : prompt('Playgroup name:');
  if (!name || !name.trim()) return;
  try {
    await apiPostJson('/playgroups', { name: name.trim() });
    await _pgReload();
    if (typeof showNotif === 'function') showNotif(`Playgroup "${name.trim()}" created — add your group members`);
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

async function deletePlaygroup(id) {
  const g = _playgroups.find(x => x.id === Number(id));
  const ok = typeof showConfirmModal === 'function'
    ? await showConfirmModal({
        title: 'Delete playgroup?',
        body: `"${escapeHtml(g ? g.name : '')}" will be removed. Members keep their accounts; only the group goes away.`,
        okLabel: 'Delete', okClass: 'btn-danger',
      })
    : confirm('Delete this playgroup?');
  if (!ok) return;
  try {
    await apiDelete(`/playgroups/${id}`);
    await _pgReload();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

async function addPlaygroupMember(groupId) {
  const sel = document.getElementById(`pgAddSel_${groupId}`);
  const userId = sel ? parseInt(sel.value, 10) : NaN;
  // The picker opens on a "Choose player…" placeholder rather than silently
  // defaulting to whoever happened to be first, so say why nothing happened.
  if (!Number.isFinite(userId)) {
    if (typeof showNotif === 'function') showNotif('Choose a player to add first', true);
    return;
  }
  try {
    await apiPostJson(`/playgroups/${groupId}/members`, { userId });
    await _pgReload();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

async function removePlaygroupMember(groupId, userId) {
  try {
    await apiDelete(`/playgroups/${groupId}/members/${userId}`);
    await _pgReload();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}
