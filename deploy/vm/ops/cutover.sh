#!/bin/sh
# One-shot cutover Railway -> this VM. Run once: sh ops/cutover.sh >> ops/cutover.log 2>&1
#   1. freeze Railway's MySQL (super_read_only: the Railway app keeps serving reads, writes fail)
#   2. final dump from the frozen DB
#   3. stop the VM app, replace the trial DB with the dump
#   4. every table's row count must match the frozen Railway DB exactly
#   5. start the VM app (price + fingerprint jobs on via .env) and wait for healthy
#   6. kick off the fingerprint catch-up, then restart the app to load the new index
# Any failure in 1-5 unfreezes Railway, which stays prod.
set -eu
cd /opt/docker/mtgarchive
log() { echo "$(date -u +%FT%TZ) $*"; }
# SQL on stdin keeps quoting sane; sed (not grep -v) so empty output is not an error.
rw() { printf '%s\n' "$1" | docker compose exec -T db sh -c 'mysql --defaults-extra-file=/tmp/railway.cnf -N railway' 2>&1 | sed '/Using a password/d'; }
vm() { printf '%s\n' "$1" | docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N' 2>&1 | sed '/Using a password/d'; }
fail() {
  log "FAILED: $*"
  docker compose stop app >/dev/null 2>&1 || true  # never two writable copies
  rw "SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;"
  log "rolled back: Railway read_only=$(rw 'SELECT @@read_only') (0 = writable again, still prod)"
  exit 1
}

log "=== cutover start"
docker compose exec -T db sh -c 'umask 077; cat > /tmp/railway.cnf' < railway-client.cnf

# 1. freeze
rw "SET GLOBAL super_read_only=ON;"
[ "$(rw 'SELECT @@super_read_only')" = 1 ] || fail "could not freeze Railway"
log "Railway frozen (read-only)"

# 2. final dump
TS=$(date -u +%Y%m%d-%H%M)
DUMP=dumps/final-$TS.sql.gz
umask 077
docker compose exec -T db sh -c 'mysqldump --defaults-extra-file=/tmp/railway.cnf --single-transaction --quick \
  --no-tablespaces --set-gtid-purged=OFF --hex-blob --default-character-set=utf8mb4 --routines --triggers --events \
  --compression-algorithms=zstd,zlib,uncompressed railway' 2> "dumps/final-$TS.err" | gzip -1 > "$DUMP"
zcat "$DUMP" | tail -n 3 | grep -q '^-- Dump completed' || fail "dump incomplete (see dumps/final-$TS.err)"
log "dump ok: $DUMP $(du -h "$DUMP" | cut -f1)"

# 3. replace the trial DB
docker compose stop app
vm "DROP DATABASE IF EXISTS mtgarchive; CREATE DATABASE mtgarchive CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL PRIVILEGES ON mtgarchive.* TO 'mtg'@'%'; SET GLOBAL innodb_flush_log_at_trx_commit=2;"
log "loading…"
if ! zcat "$DUMP" | docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 mtgarchive'; then
  vm "SET GLOBAL innodb_flush_log_at_trx_commit=1;"
  fail "load failed"
fi
vm "SET GLOBAL innodb_flush_log_at_trx_commit=1;"
log "load ok"

# 4. verify every table against the frozen source
mismatch=0
tables=$(rw "SELECT table_name FROM information_schema.tables WHERE table_schema='railway' ORDER BY table_name")
for t in $tables; do
  r=$(rw "SELECT COUNT(*) FROM \`$t\`")
  v=$(vm "SELECT COUNT(*) FROM mtgarchive.\`$t\`")
  [ "$r" = "$v" ] || { log "  MISMATCH $t railway=$r vm=$v"; mismatch=1; }
done
nr=$(echo "$tables" | wc -w); nv=$(vm "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='mtgarchive'")
[ "$nr" = "$nv" ] || { log "  table count railway=$nr vm=$nv"; mismatch=1; }
[ "$mismatch" = 0 ] || fail "row counts differ"
log "verified: $nr tables, every row count identical"

# 5. go live
docker compose up -d app
status=starting
for _ in $(seq 1 36); do
  sleep 5
  status=$(docker inspect -f '{{.State.Health.Status}}' mtgarchive 2>/dev/null || echo missing)
  [ "$status" = healthy ] || [ "$status" = unhealthy ] && break
done
[ "$status" = healthy ] || { docker compose logs --tail 40 app; fail "app not healthy ($status)"; }
docker compose logs app 2>&1 | grep -E "cron|scheduled|fingerprint index" | sed 's/^/    /'
log "=== LIVE on the VM. Railway stays frozen; it can be shut down."

# 6. fingerprint catch-up (weeks of new sets), then reload the index
log "fingerprint catch-up started (log: ops/fp-catchup.log)"
nohup sh -c 'docker compose exec -T app node scripts/build-print-fingerprints.js > ops/fp-catchup.log 2>&1 \
  && docker compose restart app >> ops/fp-catchup.log 2>&1; echo "exit=$?" >> ops/fp-catchup.log' >/dev/null 2>&1 &
