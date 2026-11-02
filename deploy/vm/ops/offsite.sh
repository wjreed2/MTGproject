#!/bin/sh
# Copy backups off the VM to Cloudflare R2 (bucket mtgarchive-backups). Runs right
# after ops/backup.sh from cron. Plain .sql.gz files, so a restore is: download one
# from the Cloudflare dashboard, then zcat it into MySQL (see deploy/vm/README.md).
#   daily/   every local backup (the VM keeps 14 days); R2 keeps 14 days
#   weekly/  the newest backup each Sunday; R2 keeps 8 weeks
# Writes ops/status/offsite.json for the ops dashboard.
set -eu
cd /opt/docker/mtgarchive
BUCKET=r2:mtgarchive-backups
# rclone's chatter and errors go to ops/offsite.err (last run only); stdout stays clean
# JSON, and no pipe hides a failed exit code from set -e.
rc() { docker compose run --rm -T rclone "$@" 2>>ops/offsite.err; }
: > ops/offsite.err
log() { echo "$(date -u +%FT%TZ) $*"; }

newest=$(ls -1t backups/mtgarchive-*.sql.gz 2>/dev/null | head -n 1)
[ -n "$newest" ] || { log "FAILED: no local backups to copy"; exit 1; }

# rclone skips files already in R2 with the same size, so this only sends new dumps.
rc copy /backups "$BUCKET/daily" --include 'mtgarchive-*.sql.gz'
if [ "$(date -u +%u)" = 7 ]; then
  rc copyto "/backups/$(basename "$newest")" "$BUCKET/weekly/$(basename "$newest")"
fi
rc delete "$BUCKET/daily" --min-age 15d
rc delete "$BUCKET/weekly" --min-age 57d

# Verify the newest dump really landed, byte count and all.
remote=$(rc lsjson "$BUCKET/daily/$(basename "$newest")" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[0]["Size"] if d else -1)' 2>/dev/null || echo -1)
local_size=$(stat -c %s "$newest")
if [ "$remote" != "$local_size" ]; then
  log "FAILED: $(basename "$newest") is $remote bytes in R2, $local_size locally"
  exit 1
fi

listing=$(rc lsjson -R "$BUCKET" --files-only)
mkdir -p ops/status
printf '%s' "$listing" | NEWEST="$(basename "$newest")" python3 -c '
import json, os, sys, time
files = json.load(sys.stdin)
out = {"at": int(time.time() * 1000), "ok": True, "newest": os.environ["NEWEST"],
       "files": len(files), "bytes": sum(f["Size"] for f in files),
       "daily": sum(1 for f in files if f["Path"].startswith("daily/")),
       "weekly": sum(1 for f in files if f["Path"].startswith("weekly/"))}
json.dump(out, open("ops/status/offsite.json.tmp", "w"))
os.replace("ops/status/offsite.json.tmp", "ops/status/offsite.json")'
log "ok $(basename "$newest") in R2 ($local_size bytes); bucket holds $(printf '%s' "$listing" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))') files"
