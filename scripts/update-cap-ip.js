const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const sim = process.argv.includes('--sim');
const url = sim
  ? 'http://localhost:3001'
  : `http://${execSync('ipconfig getifaddr en0').toString().trim()}:3001`;

const cfgPath = path.join(__dirname, '..', 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.server.url = url;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`Updated server.url → ${url}`);
