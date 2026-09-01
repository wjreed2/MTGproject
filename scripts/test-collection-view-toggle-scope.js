/**
 * Collection layout sync must not clear other page `.view-toggle`s.
 * Adding a card from Add Cards calls renderCollection() → _syncCollectionViewControls();
 * a page-wide `.view-toggle button` selector unselected Deck/Adds and the card-pool toggle.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/collection.js'), 'utf8');

function sliceFn(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

const helperSrc = sliceFn(
  'function _collectionViewToggleButtons()',
  '\nfunction _syncCollectionViewControls',
);
const syncSrc = sliceFn(
  'function _syncCollectionViewControls(activeBtn)',
  '\nlet _cardDetailFaces',
);

assert.ok(
  !syncSrc.includes("querySelectorAll('.view-toggle button')"),
  '_syncCollectionViewControls must not use a page-wide .view-toggle selector',
);
assert.ok(
  helperSrc.includes('collectionViewToggle') && helperSrc.includes('tab-collection'),
  '_collectionViewToggleButtons must scope to the collection layout toggle',
);

class FakeClassList {
  constructor(el) { this.el = el; }
  add(c) { this.el._classes.add(c); }
  remove(c) { this.el._classes.delete(c); }
  contains(c) { return this.el._classes.has(c); }
}

class FakeEl {
  constructor(opts) {
    this.id = opts.id || '';
    this.tagName = (opts.tag || 'div').toUpperCase();
    this._onclick = opts.onclick || '';
    this._classes = new Set(opts.classes || []);
    this.classList = new FakeClassList(this);
    this.children = [];
    this.parent = null;
    this.style = {};
  }
  getAttribute(name) { return name === 'onclick' ? this._onclick : null; }
  querySelectorAll(sel) {
    const all = [];
    const walk = (n) => { n.children.forEach(c => { all.push(c); walk(c); }); };
    walk(this);
    if (sel === 'button') return all.filter(e => e.tagName === 'BUTTON');
    if (sel === '.view-toggle button') {
      return all.filter(e => e.tagName === 'BUTTON' && e.parent && e.parent._classes.has('view-toggle'));
    }
    return [];
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
}

function button(onclick, classes, id) {
  return new FakeEl({ tag: 'button', onclick, classes, id });
}

function viewToggle(id, buttons, extraClasses) {
  const wrap = new FakeEl({ id, classes: ['view-toggle', ...(extraClasses || [])] });
  buttons.forEach(b => wrap.appendChild(b));
  return wrap;
}

const collectionGrid = button("setView('grid',this)", ['active']);
const collectionLarge = button("setView('large',this)", []);
const collectionToggle = viewToggle('collectionViewToggle', [collectionGrid, collectionLarge]);

const destDeck = button("setVoiceDeckAddTarget('deck')", []);
const destAdds = button("setVoiceDeckAddTarget('adds')", ['active']);
const destToggle = viewToggle('', [destDeck, destAdds]);

const poolMine = button("setDeckPoolSource('mine')", []);
const poolAll = button("setDeckPoolSource('all')", ['active']);
const poolToggle = viewToggle('', [poolMine, poolAll]);

const tabCollection = new FakeEl({ id: 'tab-collection' });
tabCollection.appendChild(collectionToggle);

const voiceModal = new FakeEl({ id: 'voiceModal' });
voiceModal.appendChild(destToggle);
voiceModal.appendChild(poolToggle);

const cardGrid = new FakeEl({ id: 'cardGrid' });

const byId = {
  collectionViewToggle: collectionToggle,
  'tab-collection': tabCollection,
  voiceModal,
  cardGrid,
};

const sandbox = {
  currentView: 'grid',
  document: {
    getElementById: id => byId[id] || null,
    querySelectorAll(sel) {
      if (sel === '.view-toggle button') {
        return [collectionGrid, collectionLarge, destDeck, destAdds, poolMine, poolAll];
      }
      return [];
    },
  },
};

vm.runInNewContext(helperSrc + '\n' + syncSrc, sandbox);
sandbox._syncCollectionViewControls();

assert.ok(collectionGrid.classList.contains('active'), 'collection Grid stays/restores active');
assert.ok(!collectionLarge.classList.contains('active'), 'collection Large stays inactive');
assert.ok(destAdds.classList.contains('active'), 'Add Cards Deck/Adds toggle must stay selected');
assert.ok(!destDeck.classList.contains('active'), 'Add Cards Deck button must stay unselected');
assert.ok(poolAll.classList.contains('active'), 'Add Cards pool toggle must stay selected');
assert.ok(!poolMine.classList.contains('active'), 'Add Cards My Collection must stay unselected');

console.log('test-collection-view-toggle-scope: ok');
