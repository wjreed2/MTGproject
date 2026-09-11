// Playgroups — named member groups. Members see each other's private decks in
// the game-tracker deck picker; the New Game player list scopes to co-members.
// Owner manages membership; any member can leave. Server: /api/playgroups.
// Uses the shared db-client wrappers (apiFetch/apiPostJson/apiDelete).

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
    const memberRows = shown.map(m => {
      const isSelf = myId != null && m.id === myId;
      const canRemove = g.isOwner ? !isSelf : isSelf; // owner removes others; member removes self (or declines)
      const removeTitle = g.isOwner ? 'Remove from playgroup' : (m.status === 'invited' ? 'Decline invite' : 'Leave playgroup');
      const tags = (m.id === g.ownerId ? '<span class="pg-tag pg-tag-owner">owner</span>' : '')
        + (m.status === 'invited' ? '<span class="pg-tag">invited</span>' : '');
      return `<div class="pg-member">
        <span class="pg-member-name">${escapeHtml(m.name || '')}${isSelf ? ' <span class="pg-you">(you)</span>' : ''}</span>
        ${tags}
        ${canRemove ? `<button class="btn btn-ghost btn-sm btn-icon pg-x-btn" title="${removeTitle}" aria-label="${removeTitle}" onclick="removePlaygroupMember(${g.id},${m.id})">${x}</button>` : ''}
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
