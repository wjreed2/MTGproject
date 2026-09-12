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
    members: (g.members || []).map(m => ({ id: Number(m.id), name: m.name, status: m.status || 'accepted' })),
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
  document.querySelectorAll('.pg-color-menu').forEach(m => m.remove());
}

/** The palette as a small body-anchored grid, like every other menu here. */
function pgOpenColorPicker(groupId, memberId, btn) {
  if (event) event.stopPropagation();
  const open = document.querySelector('.pg-color-menu');
  pgCloseColorPicker();
  if (open) return;
  const menu = document.createElement('div');
  menu.className = 'glass-menu pg-color-menu';
  const current = (playgroupMemberColor(groupId, memberId) || '').toLowerCase();
  for (const c of PLAYER_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg-color-opt' + (c.toLowerCase() === current ? ' selected' : '');
    b.style.setProperty('--sw', c);
    b.title = c;
    b.addEventListener('click', e => { e.stopPropagation(); pgCloseColorPicker(); void pgSetMemberColor(groupId, memberId, c); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const margin = 8;
  const h = menu.offsetHeight, w = menu.offsetWidth;
  const below = window.innerHeight - r.bottom;
  const top = below >= h + 10 ? r.bottom + 6 : Math.max(margin, r.top - h - 6);
  menu.style.top = Math.min(top, window.innerHeight - h - margin) + 'px';
  menu.style.left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin) + 'px';
}

async function pgSetMemberColor(groupId, memberId, color) {
  const g = _playgroups.find(x => Number(x.id) === Number(groupId));
  const m = g && (g.members || []).find(x => Number(x.id) === Number(memberId));
  if (m) { m.color = color; renderPlaygroupsPanel(); }   // paint first, then persist
  try {
    await fetch(`/api/playgroups/${groupId}/members/${memberId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ color }),
    });
  } catch (_) { showNotif('Could not save colour', true); }
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
