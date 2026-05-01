const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ip = execSync('ipconfig getifaddr en0').toString().trim();
const cfgPath = path.join(__dirname, '..', 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.server.url = `http://${ip}:3001`;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`Updated server.url → http://${ip}:3001`);
console.log('Run: npx cap sync');
