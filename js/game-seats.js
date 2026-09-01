/** Seat-order helpers for the game tracker. Array index is the seat. */

function swapSeatPair(players, i, j, activeIdx) {
  if (!Array.isArray(players)) return { players, activePlayerIdx: activeIdx, ok: false };
  const n = players.length;
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= n || j >= n || i === j) {
    return { players, activePlayerIdx: activeIdx, ok: false };
  }
  const next = players.slice();
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  let active = activeIdx;
  if (active === i) active = j;
  else if (active === j) active = i;
  return { players: next, activePlayerIdx: active, ok: true };
}

/** dir −1 = earlier seat / clockwise on the tablet; dir +1 = later seat. */
function nudgeSeat(players, fromIdx, dir, activeIdx, circular) {
  if (!Array.isArray(players) || !players.length) {
    return { players, activePlayerIdx: activeIdx, ok: false };
  }
  const n = players.length;
  if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx >= n || !dir) {
    return { players, activePlayerIdx: activeIdx, ok: false };
  }
  let toIdx = fromIdx + dir;
  if (circular) toIdx = ((toIdx % n) + n) % n;
  return swapSeatPair(players, fromIdx, toIdx, activeIdx);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { swapSeatPair, nudgeSeat };
}
