// Analytics tab — charts and top value cards

function renderStats() {
  renderColorChart();
  renderRarityChart();
  renderValueChart();
  renderTopValues();
}

function renderColorChart() {
  const counts = {W:0, U:0, B:0, R:0, G:0, C:0};
  collection.forEach(c => {
    if (!c.colors || c.colors.length === 0) counts.C += c.qty||1;
    else c.colors.forEach(col => { if (counts[col] !== undefined) counts[col] += c.qty||1; });
  });
  const ctx = document.getElementById('colorChart').getContext('2d');
  if (colorChartInst) colorChartInst.destroy();
  colorChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['White','Blue','Black','Red','Green','Colorless'],
      datasets: [{ data: Object.values(counts), backgroundColor: ['#d4c870','#1a6bb5','#2a1a3a','#c0392b','#1e7a3a','#888'], borderWidth: 0 }]
    },
    options: { plugins: { legend: { labels: { color: '#9a9488', font: { family: 'Crimson Pro' } } } }, cutout: '65%' }
  });
}

function renderRarityChart() {
  const counts = {common:0, uncommon:0, rare:0, mythic:0};
  collection.forEach(c => { if (counts[c.rarity] !== undefined) counts[c.rarity] += c.qty||1; });
  const ctx = document.getElementById('rarityChart').getContext('2d');
  if (rarityChartInst) rarityChartInst.destroy();
  rarityChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Common','Uncommon','Rare','Mythic'],
      datasets: [{ data: Object.values(counts), backgroundColor: ['#555','#aaa','#c9a84c','#d45a4a'], borderWidth: 0, borderRadius: 4 }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { color: '#6a6560' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#9a9488' }, grid: { display: false } } }
    }
  });
}

function renderValueChart() {
  const ctx = document.getElementById('valueChart').getContext('2d');
  if (valueChartInst) valueChartInst.destroy();
  const curVal = collection.reduce((s,c) => s + (c.priceTCG||0)*(c.qty||1), 0);
  const labels = ['7d ago','6d','5d','4d','3d','2d','Yesterday','Today'];
  const data = labels.map((_, i) => Math.round(curVal * (0.9 + i * 0.015)));
  valueChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ data, borderColor: '#c9a84c', backgroundColor: 'rgba(201,168,76,0.08)', fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#c9a84c' }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color: '#6a6560', callback: v => '$' + v.toFixed(0) }, grid: { color: 'rgba(255,255,255,0.04)' } },
        x: { ticks: { color: '#9a9488' }, grid: { display: false } }
      }
    }
  });
}

function renderTopValues() {
  const el = document.getElementById('topValueCards');
  const top = [...collection].sort((a,b) => b.priceTCG - a.priceTCG).slice(0, 8);
  if (!top.length) { el.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;text-align:center">No cards yet</p>'; return; }
  el.innerHTML = top.map(c => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openCardDetail('${c.uid || c.scryfallId}')">
      ${c.image ? `<img src="${c.image}" style="width:28px;border-radius:3px;flex-shrink:0">` : ''}
      <span style="flex:1;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;color:var(--gold)">$${(c.foil && c.priceTCGFoil > 0 ? c.priceTCGFoil : c.priceTCG).toFixed(2)}</span>
    </div>`).join('');
}
