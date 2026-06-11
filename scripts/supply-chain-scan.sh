#!/usr/bin/env bash
# Supply-chain / dependency health scan for MTG Archive.
#
# Runs `npm audit` plus indicator-of-compromise checks for the recent npm/PyPI
# worm campaigns (Shai-Hulud / Hades / chalk-debug wallet-drainer). Best-effort
# and side-effect free — safe to run anywhere (locally, CI, scheduled agent).
#
# Exit code: 0 = clean, 1 = something needs a human look.
#
# Usage:  bash scripts/supply-chain-scan.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

FAIL=0
note() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
bad()  { printf '  \033[31m!! %s\033[0m\n' "$1"; FAIL=1; }
ok()   { printf '  \033[32mok\033[0m %s\n' "$1"; }

note "1. npm audit (moderate+)"
if npm audit --audit-level=moderate; then
  ok "no advisories at moderate or above"
else
  bad "npm audit reported advisories (see above)"
fi

note "2. Known-compromised npm versions (chalk/debug wallet-drainer + tinycolor)"
HIT=0
while read -r pkg; do
  [ -z "$pkg" ] && continue
  name="${pkg%@*}"; ver="${pkg##*@}"
  found=$(node -e "try{console.log(require('$name/package.json').version)}catch(e){console.log('')}" 2>/dev/null)
  if [ "$found" = "$ver" ]; then bad "COMPROMISED installed: $name@$found"; HIT=1; fi
done <<'EOF'
ansi-styles@6.2.2
debug@4.4.2
chalk@5.6.1
supports-color@10.2.1
strip-ansi@7.1.1
ansi-regex@6.2.1
wrap-ansi@9.0.1
color-convert@3.1.1
color-name@2.0.1
is-arrayish@0.3.3
slice-ansi@7.1.1
color@5.0.1
color-string@2.1.1
simple-swizzle@0.2.3
supports-hyperlinks@4.1.1
has-ansi@6.0.1
chalk-template@1.1.1
backslash@0.2.1
@ctrl/tinycolor@4.1.1
@ctrl/tinycolor@4.1.2
EOF
[ "$HIT" = "0" ] && ok "none of the known-bad versions are installed"

note "3. Shai-Hulud / worm IoCs in node_modules"
if find . -name 'shai-hulud*' -not -path '*/.git/*' 2>/dev/null | grep -q .; then
  bad "found shai-hulud* artifact"; else ok "no shai-hulud* files"; fi
if grep -rlq "webhook.site" node_modules 2>/dev/null; then
  bad "webhook.site reference in node_modules (exfil indicator)"; else ok "no webhook.site references"; fi
if find node_modules -maxdepth 3 -name 'bundle.js' -size +1M 2>/dev/null | grep -q .; then
  bad "suspiciously large bundle.js in a package root"; else ok "no oversized package bundle.js"; fi

note "4. Install lifecycle scripts (informational — review if unexpected)"
find node_modules -maxdepth 2 -name package.json 2>/dev/null | while read -r f; do
  node -e "const s=(require('./$f').scripts)||{};const n=require('./$f').name||'$f';const b=['preinstall','install','postinstall'].filter(k=>s[k]);if(b.length)console.log('   '+n+' -> '+b.join(','))" 2>/dev/null
done | sort -u

note "5. Python / Hades (.pth startup-hook) IoCs — best effort"
if command -v python3 >/dev/null 2>&1; then
  DIRS=$(python3 - <<'PY' 2>/dev/null
import site
print(site.getusersitepackages())
for p in site.getsitepackages() if hasattr(site,'getsitepackages') else []:
    print(p)
PY
)
  PHIT=0
  # legit .pth files (setuptools/coloredlogs/editable installs) use exec/__import__
  # but are tiny and contain no network/obfuscation. Hades payloads are multi-MB or
  # pull the Bun runtime / decode obfuscated blobs — flag on THOSE signals, not exec alone.
  SUSPECT='base64|b64decode|urllib|requests|socket|subprocess|os\.system|eval\(|exec\(open|bun |fromCharCode|\\x[0-9a-f]{2}'
  for d in $DIRS; do
    [ -d "$d" ] || continue
    for f in "$d"/*.pth; do
      [ -e "$f" ] || continue
      grep -qE '__import__|exec\(' "$f" 2>/dev/null || continue   # only code-running .pth
      size=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
      if [ "${size:-0}" -gt 2000 ] || grep -qE "$SUSPECT" "$f" 2>/dev/null; then
        bad "review suspicious .pth (size=${size}B): $f"; PHIT=1
      fi
    done
    if grep -rlqE "DontRevokeOrItGoesBoom|The End for the Damned" "$d" 2>/dev/null; then
      bad "Hades string IoC under $d"; PHIT=1
    fi
  done
  [ "$PHIT" = "0" ] && ok "no Hades .pth/string IoCs in site-packages"
else
  ok "python3 not present — skipping Python scan"
fi

note "Result"
if [ "$FAIL" = "0" ]; then printf '  \033[32mCLEAN\033[0m\n'; else printf '  \033[31mNEEDS REVIEW\033[0m\n'; fi
exit "$FAIL"
