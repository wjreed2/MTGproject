#!/bin/sh
# Auto-deploy from origin/main. Runs every 5 min from the claude user's crontab
# (also safe to run by hand). A new commit goes live only when:
#   - it contains what is live now (never moves prod backwards or sideways), and
#   - CI ("Tests + bundle build") passed on that exact commit.
# Then: build image -> DB backup -> swap the app container -> health check,
# rolling back to the previous image if the new one does not come up healthy.
# A commit that fails (CI, build or health) is skipped until main moves again.
set -eu
cd /opt/docker/mtgarchive
BRANCH=main
CHECK_NAME="Tests + bundle build"
REPO=wjreed2/MTGproject
SKIP=ops/.skipped

log() { echo "$(date -u +%FT%TZ) $*"; }
skip() { log "skip $TARGET: $*"; echo "$TARGET" > "$SKIP"; exit 0; }
set_live() { sed -i "s/^GIT_COMMIT=.*/GIT_COMMIT=$1/" .env; }

git -C src fetch -q origin "$BRANCH"
TARGET=$(git -C src rev-parse "origin/$BRANCH")
CURRENT=$(sed -n 's/^GIT_COMMIT=//p' .env)
[ "$TARGET" = "$CURRENT" ] && exit 0
[ "$(cat "$SKIP" 2>/dev/null)" = "$TARGET" ] && exit 0

git -C src merge-base --is-ancestor "$CURRENT" "$TARGET" \
  || skip "does not contain live $(echo "$CURRENT" | cut -c1-12) (would roll back)"

ci=$(curl -fsS -m 20 "https://api.github.com/repos/$REPO/commits/$TARGET/check-runs?per_page=100" \
  | CHECK_NAME="$CHECK_NAME" python3 -c '
import json, os, sys
runs = [r for r in json.load(sys.stdin)["check_runs"] if r["name"] == os.environ["CHECK_NAME"]]
r = max(runs, key=lambda r: r["started_at"] or "") if runs else None
print("none" if not r else r["status"] + "/" + str(r["conclusion"]))') || exit 0
case "$ci" in
  completed/success) ;;
  completed/*) skip "CI $ci" ;;
  *) exit 0 ;;  # queued / running / not started: try again next tick
esac

log "deploying $TARGET (live $CURRENT)"
git -C src checkout -q --detach "$TARGET"
if ! GIT_COMMIT="$TARGET" docker compose build -q app; then
  git -C src checkout -q --detach "$CURRENT"
  skip "image build failed"
fi

sh ops/backup.sh || { git -C src checkout -q --detach "$CURRENT"; log "abort: pre-deploy backup failed"; exit 1; }

set_live "$TARGET"
docker compose up -d app

status=starting
for _ in $(seq 1 36); do  # up to 3 min
  sleep 5
  status=$(docker inspect -f '{{.State.Health.Status}}' mtgarchive 2>/dev/null || echo missing)
  [ "$status" = healthy ] && break
  [ "$status" = unhealthy ] && break
done

if [ "$status" = healthy ]; then
  log "live $TARGET"
  # Keep the live image and the one before it (instant manual rollback).
  docker image ls mtgarchive-app --format '{{.Tag}}' \
    | grep -vxF -e "$TARGET" -e "$CURRENT" \
    | while read -r tag; do docker image rm -f "mtgarchive-app:$tag" >/dev/null 2>&1 || true; done
else
  log "FAILED $TARGET (health: $status); rolling back to $CURRENT"
  docker compose logs --tail 40 app 2>&1 | sed 's/^/    /'
  set_live "$CURRENT"
  git -C src checkout -q --detach "$CURRENT"
  docker compose up -d app
  echo "$TARGET" > "$SKIP"
  exit 1
fi
