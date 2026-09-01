#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const gamesSrc = fs.readFileSync(path.join(root, 'js/games.js'), 'utf8');

const start = serverSrc.indexOf("app.get('/api/users/:id/decks'");
assert(start >= 0, 'game-tracker decks endpoint must exist');
const nextRoute = serverSrc.indexOf("app.get('/api/collection'", start);
assert(nextRoute > start, 'expected /api/collection after users/:id/decks');
const handler = serverSrc.slice(start, nextRoute);

assert(handler.includes('requireAuth'), 'deck summaries still require a signed-in session');
assert(
  !/is_public\s*=\s*1/.test(handler),
  'game-tracker deck list must not hide another player\'s private decks'
);
assert(
  handler.includes('SELECT id, data FROM decks WHERE account_id = ?'),
  'deck summaries should list every deck owned by the selected account'
);

assert(
  gamesSrc.includes('_cachedUserDecks'),
  'new-game picker must tolerate a non-array decks cache'
);
assert(
  /p\.userId\s*\n\s*\?\s*`<select onchange="ngpDeckSelect/.test(gamesSrc)
    || gamesSrc.includes('? `<select onchange="ngpDeckSelect'),
  'a selected account always gets a deck <select>, even with zero cached decks'
);
assert(
  !gamesSrc.includes("${p.userId ? 'No decks' : ''}"),
  'selected players must not be stuck on a dead "No decks" label'
);
assert(
  gamesSrc.includes('ngpDeckTyped'),
  'guest / unsigned seats must be able to type a deck name'
);

console.log('test-new-game-deck-picker: ok');
