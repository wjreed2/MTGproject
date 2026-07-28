#!/bin/bash
# Renders the goldfish engine UI with a staged midgame board into a standalone
# page (real CSS + engine JS + the real overlay markup extracted from
# index.html, with stubbed deck data) and screenshots it via headless Chrome.
# Use this to eyeball UI changes without logging in or picking a deck.
#
#   bash scripts/engine-ui-preview.sh && open /tmp/gfe-ui.png
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Extract the goldfish overlay markup (overlay div start → just before the
# bundle <script> tags at the end of the file).
START=$(awk '/id="goldfishEngineOverlay"/{print NR; exit}' "$ROOT/index.html")
END=$(awk '/<script src="dist\/scanner-card-yolo/{print NR-1; exit}' "$ROOT/index.html")

{
cat << HTMLEOF
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="file://$ROOT/styles/main.css">
<style>body { margin: 0; background: #111; }</style>
</head>
<body>
HTMLEOF
sed -n "${START},${END}p" "$ROOT/index.html"
cat << HTMLEOF
<script src="file://$ROOT/js/engine/engine-effects.js"></script>
<script src="file://$ROOT/js/engine/engine-mana.js"></script>
<script src="file://$ROOT/js/engine/engine-sba.js"></script>
<script src="file://$ROOT/js/engine/engine-static.js"></script>
<script src="file://$ROOT/js/engine/engine-replace.js"></script>
<script src="file://$ROOT/js/goldfish-engine.js"></script>
HTMLEOF
cat << 'HTMLEOF'
<script>
// ── Test harness: fake decks, open the engine, stage a midgame board ──
window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
const mk = (name, type, mana, p, t, oracle) => ({
  name, type, typeLine: type, mana: mana || '', cmc: (mana || '').replace(/[{}]/g, '').length,
  power: p, toughness: t, oracleText: oracle || '', qty: 1,
});
const playerCards = [];
for (let i = 0; i < 10; i++) playerCards.push(mk('Forest', 'Basic Land — Forest'));
for (let i = 0; i < 8; i++) playerCards.push(mk('Grizzly Bears', 'Creature — Bear', '{1}{G}', '2', '2'));
for (let i = 0; i < 6; i++) playerCards.push(mk('Llanowar Elves', 'Creature — Elf Druid', '{G}', '1', '1', '{T}: Add {G}.'));
const botCards = [];
for (let i = 0; i < 10; i++) botCards.push(mk('Swamp', 'Basic Land — Swamp'));
for (let i = 0; i < 10; i++) botCards.push(mk('Vampire Knight', 'Creature — Vampire Knight', '{1}{B}', '2', '3'));
window.decks = [{ id: 2, name: 'Bot Deck', format: 'Standard', cards: botCards }];
const myDeck = { id: 1, name: 'Test Greens', format: 'Standard', cards: playerCards };
window.getActiveDeck = () => myDeck;
window.isAdmin = () => true;

openGoldfishEngine(myDeck);

// Stage a midgame board state directly (deterministic screenshot)
setTimeout(() => {
  const bf = (n, over) => Object.assign(mk.apply(null, n), { counters: {}, markers: [], damage: 0, tapped: false }, over || {});
  _gfe.battlefield = [
    bf(['Forest', 'Basic Land — Forest'], {}),
    bf(['Forest', 'Basic Land — Forest'], {}),
    bf(['Forest', 'Basic Land — Forest'], { tapped: true }),
    bf(['Llanowar Elves', 'Creature — Elf Druid', '{G}', '1', '1', '{T}: Add {G}.'], {}),
    bf(['Grizzly Bears', 'Creature — Bear', '{1}{G}', '2', '2'], { counters: { '+1/+1': 2 } }),
    bf(['Grizzly Bears', 'Creature — Bear', '{1}{G}', '2', '2'], { tapped: true }),
    bf(['History of Benalia', 'Enchantment — Saga', '{1}{W}{W}'], { counters: { lore: 2 } }),
    bf(['Treasure', 'Token Artifact — Treasure'], { isToken: true }),
  ];
  _gfe.battlefield.forEach((c, i) => c.iid = 9100 + i);
  _gfe.opp.battlefield = [
    bf(['Swamp', 'Basic Land — Swamp'], {}),
    bf(['Swamp', 'Basic Land — Swamp'], { tapped: true }),
    bf(['Swamp', 'Basic Land — Swamp'], {}),
    bf(['Vampire Knight', 'Creature — Vampire Knight', '{1}{B}', '2', '3'], {}),
    bf(['Vampire Knight', 'Creature — Vampire Knight', '{1}{B}', '2', '3'], { counters: { '-1/-1': 1 } }),
  ];
  _gfe.opp.battlefield.forEach((c, i) => c.iid = 9200 + i);
  _gfe.life = 18; _gfe.oppLife = 14;
  _gfe.playerCounters = { energy: 2 };
  _gfe.oppCounters = { poison: 3 };
  _gfe.phase = 'main1';
  _gfeRender();
}, 800);
</script>
</body>
</html>
HTMLEOF
} > /tmp/gfe-test.html

"$CHROME" --headless --disable-gpu \
  --screenshot=/tmp/gfe-ui.png --window-size=1440,900 --virtual-time-budget=6000 \
  --allow-file-access-from-files "file:///tmp/gfe-test.html" 2>/dev/null
echo "screenshot at /tmp/gfe-ui.png"
