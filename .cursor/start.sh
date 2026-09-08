#!/usr/bin/env bash
# Per-boot startup for Cloud Agents: bring up MariaDB, ensure the app database,
# user, and base schema exist, and make sure a dev .env is present. Idempotent —
# tolerates restarts and an already-running server. Returns once the DB is ready
# so the server terminal starts against a live database.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_NAME="mtgproject"
DB_USER="mtg"

# ── Dev .env (never committed; secrets generated at runtime) ──
if [ ! -f .env ]; then
  echo "[start] Creating dev .env…"
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  CHANGELOG_INGEST_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  DB_PASS="$(openssl rand -hex 16)"
  cat > .env <<EOF
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_NAME=${DB_NAME}
PORT=3001
BIND_HOST=127.0.0.1
SESSION_SECRET=${SESSION_SECRET}
CHANGELOG_INGEST_SECRET=${CHANGELOG_INGEST_SECRET}
MTG_API_URL=http://127.0.0.1:3001
EOF
fi

# Load DB credentials from .env (authoritative for the MySQL user below).
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# ── Ensure MariaDB data directory is initialized ──
if [ ! -d /var/lib/mysql/mysql ]; then
  echo "[start] Initializing MariaDB data directory…"
  sudo mariadb-install-db --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1 || true
fi

sudo mkdir -p /var/run/mysqld
sudo chown mysql:mysql /var/run/mysqld

# ── Start MariaDB if it isn't already accepting connections ──
if ! sudo mysqladmin ping >/dev/null 2>&1; then
  echo "[start] Starting MariaDB…"
  sudo bash -c 'nohup mariadbd-safe --datadir=/var/lib/mysql >/var/log/mariadb-boot.log 2>&1 &'
  for i in $(seq 1 60); do
    if sudo mysqladmin ping >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

if ! sudo mysqladmin ping >/dev/null 2>&1; then
  echo "[start] ERROR: MariaDB did not come up." >&2
  exit 1
fi
echo "[start] MariaDB is up."

# ── Ensure database, application user, and base schema exist (idempotent) ──
sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

echo "[start] Loading base schema (db/schema.sql)…"
sudo mysql "${DB_NAME}" < db/schema.sql

echo "[start] Database ready. The server's own migrations run on npm start."
