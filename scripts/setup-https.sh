#!/usr/bin/env bash
# Generates a locally-trusted HTTPS cert for the Mac's LAN IP using mkcert.
# After running this, `npm run dev` will serve HTTPS automatically.
# The iPhone must trust the mkcert root CA (see step 4 below).

set -e

echo "==> Checking for mkcert..."
BREW=/opt/homebrew/bin/brew
if ! command -v mkcert &> /dev/null && ! /opt/homebrew/bin/mkcert --version &> /dev/null 2>&1; then
  echo "Installing mkcert via Homebrew..."
  $BREW install mkcert
fi

MKCERT=$(command -v mkcert || echo /opt/homebrew/bin/mkcert)
echo "==> Installing mkcert root CA into system trust stores..."
$MKCERT -install

echo "==> Detecting LAN IP..."
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -z "$IP" ]; then
  echo "ERROR: Could not detect LAN IP. Are you on WiFi?"
  exit 1
fi
echo "    LAN IP: $IP"

echo "==> Generating cert for $IP + localhost..."
CERTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERTS_DIR"
cd "$CERTS_DIR"
$MKCERT "$IP" localhost 127.0.0.1

# mkcert names the files based on the first domain — rename to fixed names
for f in *.pem; do
  case "$f" in
    *-key.pem) mv "$f" server-key.pem ;;
    *.pem)     mv "$f" server.pem     ;;
  esac
done 2>/dev/null || true

echo ""
echo "✓ Done! Certs written to certs/server.pem and certs/server-key.pem"
echo ""
echo "Next steps:"
echo "  1. Run: npm run dev"
echo "     Server will print: 'running at https://localhost:3001  (HTTPS)'"
echo ""
echo "  2. Update capacitor.config.json server.url to: https://$IP:3001"
echo "     Then: npm run cap:sync"
echo ""
echo "  3. On your iPhone — trust the mkcert root CA:"
echo "     a. AirDrop this file to your phone:"
echo "        $($MKCERT -CAROOT)/rootCA.pem"
echo "     b. On iPhone: Settings → General → VPN & Device Management → trust the cert"
echo "     c. Settings → General → About → Certificate Trust Settings → enable full trust"
echo ""
echo "  Camera and mic will now work in the Capacitor app on your real device."
