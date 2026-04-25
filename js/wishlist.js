// Wishlist tab

function renderWishlist() {
  const el = document.getElementById('wishlistItems');
  const empty = document.getElementById('wishlistEmpty');
  const total = document.getElementById('wishlistTotal');
  if (wishlist.length === 0) {
    el.innerHTML = ''; empty.style.display = 'block';
    total.textContent = '';
    document.getElementById('wlTCGLow').textContent = '—';
    document.getElementById('wlTCGMid').textContent = '—';
    document.getElementById('wlCK').textContent = '—';
    return;
  }
  empty.style.display = 'none';
  total.textContent = wishlist.length + ' cards';

  const totalTCG = wishlist.reduce((s,c) => s + (c.priceTCG||0), 0);
  const totalCK = wishlist.reduce((s,c) => s + (c.priceCK||0), 0);
  document.getElementById('wlTCGLow').textContent = '$' + (totalTCG * 0.8).toFixed(2);
  document.getElementById('wlTCGMid').textContent = '$' + totalTCG.toFixed(2);
  document.getElementById('wlCK').textContent = '$' + totalCK.toFixed(2);

  el.innerHTML = wishlist.map((c,i) => `
    <div class="wishlist-item">
      <div class="wishlist-priority priority-${c.priority||'med'}"></div>
      ${c.image ? `<img src="${c.image}" style="width:30px;border-radius:3px;flex-shrink:0" alt="">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
        <div style="font-size:0.72rem;color:var(--text3)">${c.set?.toUpperCase()} • $${(c.priceTCG||0).toFixed(2)}</div>
      </div>
      <button class="btn btn-primary btn-sm btn-icon" onclick="moveWishlistToCollection(${i})" title="Mark as acquired" style="padding:3px 7px;font-size:0.72rem">✓</button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="removeWishlist(${i})" style="padding:3px 7px;font-size:0.72rem">✕</button>
    </div>`).join('');
}

async function searchWishlist(q) {
  const el = document.getElementById('wishlistSearchResults');
  if (!q || q.length < 2) { el.innerHTML = ''; return; }
  const cards = await searchCards(q + ' -is:extra');
  el.innerHTML = cards.slice(0, 8).map(c => {
    const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
    return `<div style="cursor:pointer" onclick="addToWishlistCard('${c.id}','${encodeURIComponent(JSON.stringify({id:c.id,scryfallId:c.id,name:c.name,set:c.set,image:img,imageLarge:c.image_uris?.large||c.card_faces?.[0]?.image_uris?.large,type:c.type_line,priceTCG:parseFloat(c.prices?.usd||0),priceCK:parseFloat(c.prices?.usd||0)*0.88,colors:c.colors||[],cmc:c.cmc||0,rarity:c.rarity}))}')">
      <div style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:1px solid var(--border)" onmouseover="this.style.borderColor='var(--gold)';document.getElementById('wishlistPreview').innerHTML='<img src=\\'${img||''}\\'style=\\'max-width:100%;border-radius:8px\\'alt=\\'\\'>';" onmouseout="this.style.borderColor='var(--border)'">
        ${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover">` : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:0.65rem;padding:4px;text-align:center;color:var(--text2)">${c.name}</div>`}
      </div>
      <div style="font-size:0.65rem;color:var(--text3);text-align:center;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">$${parseFloat(c.prices?.usd||0).toFixed(2)}</div>
    </div>`;
  }).join('');
}

function addToWishlistCard(id, dataStr) {
  const data = JSON.parse(decodeURIComponent(dataStr));
  const priority = document.getElementById('wishlistPriority').value;
  if (wishlist.find(c => c.scryfallId === id)) { showNotif('Already in wishlist'); return; }
  wishlist.push({...data, priority, addedAt: Date.now()});
  save(); renderWishlist();
  showNotif('Added to wishlist');
}

function addToWishlistFromDetail(uid) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  if (wishlist.find(c => c.scryfallId === card.scryfallId)) { showNotif('Already in wishlist'); return; }
  wishlist.push({...card, priority: 'med'}); save(); showNotif('Added to wishlist');
}

function addToWishlistManual() {
  const q = document.getElementById('wishlistSearch').value;
  if (!q) return;
  searchWishlist(q);
}

function removeWishlist(i) { wishlist.splice(i, 1); save(); renderWishlist(); }

function moveWishlistToCollection(i) {
  const card = wishlist[i];
  const wUid = card.scryfallId + '_n';
  const existing = collection.find(c => c.uid === wUid);
  if (existing) { existing.qty++; } else { collection.push({...card, uid: wUid, qty: 1, addedAt: Date.now()}); }
  wishlist.splice(i, 1); save(); renderWishlist(); renderCollection(); showNotif('Moved to collection!');
}
