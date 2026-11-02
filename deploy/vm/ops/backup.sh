#!/bin/sh
# Nightly MySQL dump of the mtgarchive DB -> /opt/docker/mtgarchive/backups.
# Runs from the claude user's crontab. Consistent snapshot without locking
# (--single-transaction); keeps the last KEEP_DAYS days on this machine.
# This guards against bad deploys and deletes, NOT against losing the VM.
set -eu
cd /opt/docker/mtgarchive
KEEP_DAYS=14
OUT=backups/mtgarchive-$(date -u +%Y%m%d-%H%M).sql.gz
umask 077
mkdir -p backups

docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot \
  --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --hex-blob \
  --default-character-set=utf8mb4 --routines --triggers --events mtgarchive' \
  | gzip -6 > "$OUT.partial"

# A dump that died midway still gzips cleanly; only the trailer proves completion.
if zcat "$OUT.partial" | tail -n 3 | grep -q '^-- Dump completed'; then
  mv "$OUT.partial" "$OUT"
  echo "$(date -u +%FT%TZ) ok $OUT $(du -h "$OUT" | cut -f1)"
else
  echo "$(date -u +%FT%TZ) FAILED $OUT (no completion trailer); kept as $OUT.partial" >&2
  exit 1
fi

find backups -name 'mtgarchive-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find backups -name '*.partial' -mtime +2 -delete
