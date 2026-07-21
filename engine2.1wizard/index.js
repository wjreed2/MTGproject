'use strict';
// engine2.1wizard — SANDBOX copy of engine2 for Suggested Adds / Plan wizard marriage tests.
// Do not edit ../engine2/ in this workstream. Live Semantic mode still requires('./engine2').
// Server-side pure modules; deliberately NOT part of the client bundle (build:bundle
// concatenates an explicit js/* list). Wire via require('./engine2.1wizard') only when testing.

module.exports = {
  vocab: require('./vocab'),
  irSchema: require('./ir-schema'),
  validator: require('./validator'),
  prompt: require('./prompt'),
  interactions: require('./interactions'),
  deckGoals: require('./deck-goals'),
  thresholds: require('./thresholds'),
  goalTemplates: require('./goal-templates'),
  recommender: require('./recommender'),
  explain: require('./explain'),
  wizardBridge: require('./wizard-bridge'),
};
