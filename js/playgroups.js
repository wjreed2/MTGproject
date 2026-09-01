// Playgroups — named member groups. Members see each other's private decks in
// the game-tracker deck picker; the New Game player list scopes to co-members.
// Owner manages membership; any member can leave. Server: /api/playgroups.

let _playgroups = [];
let _playgroupsLoaded = false;
let _pgAllUsers = [];   // [{id, name}] for the add-member picker

function _pgApiBase() {
  return typeof mtgApiRoot === 'function' ? mtgApiRoot() : '/api';
}

async function _pgFetch(path, opts) {
  const res = await fetch(`${_pgApiBase()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadPlaygroupsPanel() {
  const host = document.getElementById('playgroupsPanel');
  if (!host) return;
  if (!_playgroupsLoaded) host.innerHTML = '<div style="color:var(--text3);font-size:0.78rem">Loading…</div>';
  try {
    const [data, users] = await Promise.all([
      _pgFetch('/playgroups'),
      _pgFetch('/users'),
    ]);
    _playgroups = Array.isArray(data.playgroups) ? data.playgroups : [];
    _pgAllUsers = Array.isArray(users) ? users : [];
    _playgroupsLoaded = true;
  } catch (e) {
    host.innerHTML = `<div style="color:var(--red);font-size:0.78rem">${escapeHtml(e.message)}</div>`;
    return;
  }
  renderPlaygroupsPanel();
}

function renderPlaygroupsPanel() {
  const host = document.getElementById('playgroupsPanel');
  if (!host) return;
  if (!_playgroups.length) {
    host.innerHTML = `<div style="color:var(--text3);font-size:0.78rem;line-height:1.45">
      No playgroups yet. Create one and add your group — members can pick each
      other's decks (including private ones) when starting a game.</div>`;
    return;
  }
  const myId = (typeof currentUser !== 'undefined' && currentUser?.id != null) ? Number(currentUser.id) : null;
  host.innerHTML = _playgroups.map(g => {
    const memberRows = (g.members || []).map(m => {
      const isSelf = myId != null && Number(m.id) === myId;
      const canRemove = g.isOwner ? !isSelf : isSelf; // owner removes others; member removes self
      const removeTitle = g.isOwner ? 'Remove from playgroup' : 'Leave playgroup';
      return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0">
        <span style="font-size:0.78rem;color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.name || '')}${isSelf ? ' <span style="color:var(--text3)">(you)</span>' : ''}${Number(m.id) === Number(g.ownerId) ? ' <span style="color:var(--gold);font-size:0.66rem">owner</span>' : ''}</span>
        ${canRemove ? `<button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:0.7rem;color:var(--red)" title="${removeTitle}" onclick="removePlaygroupMember(${g.id},${Number(m.id)})">✕</button>` : ''}
      </div>`;
    }).join('');
    const addable = _pgAllUsers.filter(u => !(g.members || []).some(m => Number(m.id) === Number(u.id)));
    const addRow = g.isOwner && addable.length ? `
      <div style="display:flex;gap:6px;margin-top:6px">
        <select id="pgAddSel_${g.id}" style="flex:1;font-size:0.75rem;padding:3px 6px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:var(--radius)">
          ${addable.map(u => `<option value="${Number(u.id)}">${escapeHtml(u.name || '')}</option>`).join('')}
        </select>
        <button class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:3px 8px" onclick="addPlaygroupMember(${g.id})">Add</button>
      </div>` : '';
    const deleteBtn = g.isOwner
      ? `<button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:0.7rem;color:var(--red)" title="Delete playgroup" onclick="deletePlaygroup(${g.id})">✕</button>`
      : '';
    return `<div style="border:1px solid var(--border);border-radius:var(--radius);padding:7px 9px;margin-bottom:8px;background:var(--bg3)">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="font-family:'Cinzel',serif;font-size:0.8rem;color:var(--text);flex:1">${escapeHtml(g.name || '')}</span>
        ${deleteBtn}
      </div>
      ${memberRows}
      ${addRow}
    </div>`;
  }).join('');
}

async function openCreatePlaygroup() {
  const name = prompt('Playgroup name:');
  if (!name || !name.trim()) return;
  try {
    await _pgFetch('/playgroups', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    await loadPlaygroupsPanel();
    if (typeof showNotif === 'function') showNotif(`Playgroup "${name.trim()}" created — add your group members`);
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

async function deletePlaygroup(id) {
  const g = _playgroups.find(x => Number(x.id) === Number(id));
  if (!confirm(`Delete playgroup "${g ? g.name : ''}"? Members keep their accounts; only the group is removed.`)) return;
  try {
    await _pgFetch(`/playgroups/${id}`, { method: 'DELETE' });
    await loadPlaygroupsPanel();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

async function addPlaygroupMember(groupId) {
  const sel = document.getElementById(`pgAddSel_${groupId}`);
  const userId = sel ? parseInt(sel.value, 10) : NaN;
  if (!Number.isFinite(userId)) return;
  try {
    await _pgFetch(`/playgroups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ userId }) });
    await loadPlaygroupsPanel();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}

async function removePlaygroupMember(groupId, userId) {
  try {
    await _pgFetch(`/playgroups/${groupId}/members/${userId}`, { method: 'DELETE' });
    await loadPlaygroupsPanel();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message, true);
  }
}
