#!/usr/bin/env bash
# Idempotent repository bootstrap for Cloud Agents.
# Installs the MySQL-compatible server (MariaDB) the app needs and refreshes
# Node dependencies. Safe to run repeatedly and against a cached/snapshot state.
set -euo pipefail

cd "$(dirname "$0")/.."

# ── System dependency: MariaDB (drop-in MySQL for mysql2 / express-mysql-session) ──
if ! command -v mariadbd >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
  echo "[install] Installing MariaDB server…"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    mariadb-server mariadb-client
else
  echo "[install] MariaDB already present — skipping apt install."
fi

# ── Node dependencies (pinned by package-lock.json) ──
echo "[install] Installing npm dependencies…"
npm ci

echo "[install] Done."
