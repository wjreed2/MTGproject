#!/usr/bin/env bash
# Generates a locally-trusted HTTPS cert for the Mac's LAN IP(s) using mkcert.
# After running this, `npm start` / `npm run dev` will serve HTTPS automatically.
# The iPhone must trust the mkcert root CA (see step 4 below).
#
# If your Mac's Wi‑Fi IP changed (new cert SANs required), run this again, then
# `npm run cap:device` so capacitor.config.json matches.

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

echo "==> Detecting LAN IP(s)…"
CERTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERTS_DIR"
cd "$CERTS_DIR"

# Optional: force one IP if auto-detect is wrong, e.g. LAN_IP=192.168.0.12 bash scripts/setup-https.sh
HOSTS=(localhost 127.0.0.1)
if [ -n "${LAN_IP:-}" ]; then
  HOSTS+=("$LAN_IP")
  echo "    Using LAN_IP from env: $LAN_IP"
else
  for iface in en0 en1; do
    a=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    if [ -n "$a" ]; then
      HOSTS+=("$a")
      echo "    $iface: $a"
    fi
  done
fi

# Dedupe (macOS bash 3.2–compatible)
UNIQ=()
for h in "${HOSTS[@]}"; do
  dup=
  for u in "${UNIQ[@]}"; do
    if [ "$u" = "$h" ]; then dup=1; break; fi
  done
  if [ -z "$dup" ]; then UNIQ+=("$h"); fi
done

if [ "${#UNIQ[@]}" -lt 2 ]; then
  echo "ERROR: No LAN IP found. Set LAN_IP=192.168.x.x or connect Wi‑Fi."
  exit 1
fi

echo "==> Generating cert for: ${UNIQ[*]}"
rm -f server.pem server-key.pem
"$MKCERT" -cert-file server.pem -key-file server-key.pem "${UNIQ[@]}"

echo ""
echo "✓ Done! Certs written to certs/server.pem and certs/server-key.pem"
echo ""
PRIMARY_IP=""
for x in "${UNIQ[@]}"; do
  case "$x" in
    localhost|127.0.0.1) ;;
    *) PRIMARY_IP=$x; break ;;
  esac
done
echo "Next steps:"
echo "  1. Restart the server (npm start or npm run dev)."
echo ""
echo "  2. Point the app at the same host the cert covers, e.g.:"
echo "       https://${PRIMARY_IP:-127.0.0.1}:3001"
echo "     Run: npm run cap:device   (updates capacitor.config.json server.url)"
echo ""
echo "  3. On iPhone — trust mkcert root (only needed once per phone):"
echo "     a. AirDrop this file to your phone:"
echo "        $($MKCERT -CAROOT)/rootCA.pem"
echo "     b. Settings → General → VPN & Device Management → install profile"
echo "     c. Settings → General → About → Certificate Trust Settings → enable full trust for the mkcert CA"
echo ""
echo "  If Safari still says the cert is invalid for this IP, re-run this script"
echo "  after your Mac gets a new Wi‑Fi address (or set LAN_IP explicitly)."
