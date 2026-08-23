/**
 * Load Foundation engine + Evaluation Lab modules onto globalThis for Node.
 */
function loadFoundationLab() {
  require('../foundation/foundation-config.js');
  require('../foundation/foundation-engine.js');
  require('../foundation/foundation-suggest.js');
  require('./catalog.js');
  require('./normalize.js');
  require('./evidence.js');
  require('./cardir-inventory.js');
  require('./live-decks.js');
  require('./adapter.js');
  require('./ratings.js');
  require('./compare.js');
  require('./report.js');
  return globalThis;
}

module.exports = { loadFoundationLab };
