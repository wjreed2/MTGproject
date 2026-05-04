const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3001);
const hasTls =
  fs.existsSync(path.join(root, 'certs', 'server.pem')) &&
  fs.existsSync(path.join(root, 'certs', 'server-key.pem'));

const sim = process.argv.includes('--sim');

let url;
if (sim) {
  // 127.0.0.1 matches SANs from npm run setup:https (mkcert includes it).
  url = hasTls ? `https://127.0.0.1:${PORT}` : `http://127.0.0.1:${PORT}`;
} else {
  let ip = '';
  try {
    ip = execSync('ipconfig getifaddr en0', { encoding: 'utf8' }).trim();
  } catch (_) {}
  if (!ip) {
    console.error('Could not read LAN IP from en0. Use Wi‑Fi or set IP manually in capacitor.config.json server.url.');
    process.exit(1);
  }
  url = hasTls ? `https://${ip}:${PORT}` : `http://${ip}:${PORT}`;
}

const cfgPath = path.join(__dirname, '..', 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.server = cfg.server || {};
cfg.server.url = url;
// Cleartext is only for http:// dev without TLS; camera/mic need https:// on device.
cfg.server.cleartext = !hasTls;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`Updated server.url → ${url} (cleartext: ${cfg.server.cleartext})`);
if (hasTls && !sim) {
  console.log('Trust the mkcert root CA on your iPhone (see npm run setup:https) or HTTPS will fail.');
}
