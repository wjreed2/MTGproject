# Production on host01 (tensorcrafted.com)

Production runs on a Debian VM, `host01.tensorcrafted.com`, as a docker compose
stack. It moved off Railway on 2026-11-02. This folder is a copy of the live
config on the VM, kept here so it is versioned and the box can be rebuilt. The
VM is still where it runs: change a file here, then copy it to the VM (see
[Changing this setup](#changing-this-setup)).

## Request path

```
browser ─► Cloudflare ─► HAProxy (owner's, TLS ends here) ─► web01 nginx :80 ─► mtgarchive :80 (app)
                                                                  └─ /ops/ ─► mtgarchive-ops :80 (dashboard)
```

- **Cloudflare** is in front of HAProxy, so the visitor's IP arrives in
  `CF-Connecting-IP`. `web01/default.conf` hands it to the app as the last
  `X-Forwarded-For` entry (the app trusts one proxy hop) and passes HAProxy's
  `X-Forwarded-Proto: https` through untouched, which is what lets the app set
  its secure session cookie. Do not switch these to `$proxy_add_x_forwarded_for`
  or `$scheme`.
- **HAProxy** times out plain HTTP responses after 30s. Slow admin jobs that
  answer only when done (Run price job, Recompute EDHREC percentiles) show an
  error but keep running. WebSockets (socket.io) are unaffected.
- **web01** belongs to the server owner (`apexx`). Its stock config is kept
  next to ours as `default.conf.bak`; editing it needs `sudo`.

## Layout on the VM: `/opt/docker/mtgarchive`

| Path | What |
|---|---|
| `docker-compose.yml` | `db` (MySQL 9.7, no published port), `app`, `ops`, `dockerproxy` |
| `Dockerfile`, `Dockerfile.dockerignore` | App image, built from `src/`. `dist/` is committed, so no build step. Dev deps are installed because the fingerprint builder needs `sharp`. |
| `src/` | Git clone of this repo, checked out at the live commit |
| `.env` | Secrets, chmod 600. Names in [`.env.example`](.env.example). |
| `r2.env` | Cloudflare R2 key for off-site backups, chmod 600 |
| `data/` | The MySQL data directory. **This bind mount is the database.** |
| `mysql.cnf` | 1G buffer pool, performance_schema off |
| `backups/` | Nightly dumps, 14 days |
| `ops/` | `deploy.sh`, `backup.sh`, `offsite.sh`, `collect.py`, logs, `status/` |
| `opsui/`, `opsui-data/` | Ops dashboard code and its 24h metric history |
| `dumps/` | The Railway migration dumps (trial + final) |

Every service rotates its Docker logs at 10 MB × 3.

## Deploys

`ops/deploy.sh` runs every 5 minutes from the `claude` user's crontab
([`ops/crontab.txt`](ops/crontab.txt)). A new `main` commit goes live only when:

1. it contains the live commit (auto-deploy never moves the site backwards), and
2. CI ("Tests + bundle build") passed on that exact commit.

Then it builds the image, backs up the database, swaps the app container and
waits for a healthy check. If the new version is not healthy within 3 minutes it
switches back to the previous image. A commit that fails CI, the build or the
health check is recorded in `ops/.skipped` and retried only when `main` moves
again. Log: `ops/deploy.log`.

**Release flow:** merge work into `development`, then merge a `development → main`
release PR. The VM picks `main` up within about 5 minutes of CI passing.

**Manual rollback:** set `GIT_COMMIT=<previous sha>` in `.env`, then
`git -C src checkout <sha> && docker compose up -d app`. The previous image is
kept, so this needs no rebuild.

## Backups

`ops/backup.sh` runs nightly at 08:30 UTC (3:30 AM Eastern): one consistent
`mysqldump --single-transaction`, gzipped, kept 14 days on the VM, verified by the
dump's completion trailer. Each deploy also takes one first.

Right after it, `ops/offsite.sh` copies them to **Cloudflare R2** (Will's account,
bucket `mtgarchive-backups`) with the `rclone` compose tool: `daily/` keeps 14 days,
`weekly/` keeps each Sunday's dump for 8 weeks. It checks the newest file's byte
count in R2 and writes `ops/status/offsite.json`; the dashboard turns red if no
upload has verified in 36 hours. The files are plain `.sql.gz` (no extra
encryption layer, by choice), so restoring after losing the VM is: download one
from the Cloudflare dashboard, then load it as below. The R2 key lives in
`r2.env` (chmod 600; names in [`r2.env.example`](r2.env.example)) and can only
read and write that one bucket.

Restore a dump into a fresh database:

```sh
cd /opt/docker/mtgarchive
docker compose stop app
zcat backups/<file>.sql.gz | docker compose exec -T db sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot mtgarchive'
docker compose up -d app
```

## Ops dashboard: https://tensorcrafted.com/ops/

Read-only. Shows host and per-service CPU, memory, disk and network, response
time through Cloudflare vs inside the VM, uptime, deploys, backups, table sizes
and logs.

- **Access:** the `ops` service forwards the visitor's session cookie to the
  app's admin-only `/api/admin/scryfall/import-status` on every request (cached
  60s). Only an app admin gets in, whatever nginx does.
- **Docker:** through `dockerproxy` (tecnativa/docker-socket-proxy), which allows
  GET only: list, inspect, stats, logs, images. It sits on an internal network
  only `ops` can reach.
- **No credentials inside:** DB stats come from `ops/collect.py`, which runs on
  the host every 10 minutes and writes `ops/status/db.json`.

## Rebuilding the VM from scratch

1. `mkdir /opt/docker/mtgarchive && cd` there; copy this folder's files in;
   `git clone https://github.com/wjreed2/MTGproject.git src` and check out the
   commit to run.
2. Write `.env` from [`.env.example`](.env.example) with new secrets, and set
   `GIT_COMMIT` to that commit.
3. `docker compose up -d db`, wait for healthy, load the newest backup
   (see Backups), then `docker compose up -d`.
4. Install `web01/default.conf` into `/opt/docker/web01/nginx/` and add its
   mount to web01's compose file ([`web01/docker-compose.yml`](web01/docker-compose.yml)),
   then `docker compose up -d` in `/opt/docker/web01`.
5. Install the crontab from [`ops/crontab.txt`](ops/crontab.txt) as the user
   that owns the stack.

`ops/cutover.sh` is the one-shot Railway → VM migration script, kept for the record.

## Changing this setup

Edit the file here, open a PR like any other change, then copy it to the same
path on the VM and apply it: `docker compose up -d <service>` for compose or
Dockerfile changes, `docker exec web01 nginx -t && docker exec web01 nginx -s reload`
for nginx. Auto-deploy only updates the app code in `src/`; it never touches
these files.
