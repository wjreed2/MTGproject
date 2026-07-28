'use strict';

const assert = require('assert');
const {
  parseAllowedOrigins,
  isAllowedOrigin,
} = require('../lib/cors-origins');

const defaults = parseAllowedOrigins({ PORT: '3001' });
assert(defaults.has('https://localhost:3001'));
assert(defaults.has('https://127.0.0.1:3001'));
assert(defaults.has('capacitor://localhost'));
assert.strictEqual(defaults.has('https://192.168.0.20:3001'), false);

const fromEnv = parseAllowedOrigins({
  ALLOWED_ORIGIN: 'https://a.example, https://b.example',
});
assert.deepStrictEqual([...fromEnv].sort(), ['https://a.example', 'https://b.example']);

const withLan = parseAllowedOrigins({
  ALLOWED_ORIGIN: 'https://localhost:3001,https://192.168.0.20:3001',
});
assert.strictEqual(
  isAllowedOrigin('https://192.168.0.20:3001', { allowedOrigins: withLan }),
  true,
  'LAN origin allowed only when listed in ALLOWED_ORIGIN'
);
assert.strictEqual(
  isAllowedOrigin('https://192.168.0.20:3001', { allowedOrigins: defaults }),
  false,
  'LAN origin rejected when not whitelisted'
);
assert.strictEqual(
  isAllowedOrigin('https://evil.example', { allowedOrigins: defaults }),
  false
);
assert.strictEqual(isAllowedOrigin(undefined, { allowedOrigins: defaults }), true);
assert.strictEqual(
  isAllowedOrigin('https://localhost:3001', { allowedOrigins: defaults }),
  true
);

console.log('test-cors-origins: ok');
