'use strict';
// engine2 — the new MTG semantics/interaction engine (docs/engine2-plan.md).
// Server-side pure modules; deliberately NOT part of the client bundle (build:bundle
// concatenates an explicit js/* list). server.js and scripts/ require from here.

module.exports = {
  vocab: require('./vocab'),
  irSchema: require('./ir-schema'),
  validator: require('./validator'),
  prompt: require('./prompt'),
};
