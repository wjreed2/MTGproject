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
  if (!host.childElementCount) host.innerHTML = '<div class="pg-muted">Loading…</div>';
  try {
    const [data, users] = await Promise.all([
      apiFetch('/playgroups'),
      _pgAllUsers ? Promise.resolve(_pgAllUsers) : apiFetch('/users'),
    ]);
    _playgroups = _pgNormalize(data.playgroups);
    _pgAllUsers = (Array.isArray(users) ? users : []).map(u => ({ id: Number(u.id), name: u.name }));
  } catch (e) {
    host.innerHTML = `<div class="pg-muted" style="color:var(--red)">${escapeHtml(e.message)}</div>`;
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

function renderPlaygroupsPanel() {
  const host = document.getElementById('playgroupsPanel');
  if (!host) return;
  if (!_playgroups.length) {
    host.innerHTML = `<div class="pg-muted" style="line-height:1.45">
      No playgroups yet. Create one and add your group — members can pick each
      other's decks (including private ones) when starting a game.</div>`;
    return;
  }
  const myId = (typeof currentUser !== 'undefined' && currentUser?.id != null) ? Number(currentUser.id) : null;
  host.innerHTML = _playgroups.map(g => {
    const selfInvited = g.members.some(m => myId != null && m.id === myId && m.status === 'invited');
    const memberRows = g.members.map(m => {
      const isSelf = myId != null && m.id === myId;
      const canRemove = g.isOwner ? !isSelf : isSelf; // owner removes others; member removes self (or declines)
      const removeTitle = g.isOwner ? 'Remove from playgroup' : (m.status === 'invited' ? 'Decline invite' : 'Leave playgroup');
      const statusTag = m.status === 'invited' ? ' <span style="color:var(--text3);font-size:0.66rem">invited</span>' : '';
      return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0">
        <span class="pg-member-name">${escapeHtml(m.name || '')}${isSelf ? ' <span style="color:var(--text3)">(you)</span>' : ''}${m.id === g.ownerId ? ' <span style="color:var(--gold);font-size:0.66rem">owner</span>' : ''}${statusTag}</span>
        ${canRemove ? `<button class="btn btn-ghost btn-sm pg-x-btn" title="${removeTitle}" onclick="removePlaygroupMember(${g.id},${m.id})">✕</button>` : ''}
      </div>`;
    }).join('');
    const acceptRow = selfInvited
      ? `<div style="margin-top:6px"><button class="btn btn-primary btn-sm" style="font-size:0.72rem;padding:3px 10px" onclick="acceptPlaygroupInvite(${g.id})">Accept invite</button></div>`
      : '';
    const addable = (_pgAllUsers || []).filter(u => !g.members.some(m => m.id === u.id));
    const addRow = g.isOwner && addable.length ? `
      <div style="display:flex;gap:6px;margin-top:6px">
        <select id="pgAddSel_${g.id}" class="pg-add-select">
          ${addable.map(u => `<option value="${u.id}">${escapeHtml(u.name || '')}</option>`).join('')}
        </select>
        <button class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:3px 8px" onclick="addPlaygroupMember(${g.id})">Add</button>
      </div>` : '';
    const deleteBtn = g.isOwner
      ? `<button class="btn btn-ghost btn-sm pg-x-btn" title="Delete playgroup" onclick="deletePlaygroup(${g.id})">✕</button>`
      : '';
    return `<div class="pg-group">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span class="pg-group-name">${escapeHtml(g.name || '')}</span>
        ${deleteBtn}
      </div>
      ${memberRows}
      ${acceptRow}
      ${addRow}
    </div>`;
  }).join('');
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
  if (!Number.isFinite(userId)) return;
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
