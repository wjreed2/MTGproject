#!/usr/bin/env python3
"""Writes ops/status/db.json for the ops dashboard (run from cron every 10 min).

Runs on the host so the dashboard container never holds DB credentials: it
reads this file instead of querying MySQL itself.
"""
import json
import os
import subprocess
import time

STACK = "/opt/docker/mtgarchive"
OUT = os.path.join(STACK, "ops", "status", "db.json")


def db(cmd, stdin=None):
    """Run a shell command inside the db container and return stdout."""
    return subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "sh", "-c", cmd],
        cwd=STACK, input=stdin, capture_output=True, text=True, check=True, timeout=120,
    ).stdout


def mysql(sql):
    return db('MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B', stdin=sql)


def du(path):
    out = subprocess.run(["du", "-sb", path], capture_output=True, text=True, timeout=120).stdout
    return int(out.split()[0]) if out else 0


def main():
    version = mysql("SELECT VERSION();").strip()
    status = dict(
        line.split("\t", 1)
        for line in mysql(
            "SHOW GLOBAL STATUS WHERE Variable_name IN "
            "('Uptime','Threads_connected','Max_used_connections','Questions','Slow_queries');"
        ).strip().splitlines()
    )
    tables = json.loads(mysql(
        "SELECT JSON_ARRAYAGG(JSON_OBJECT('name', table_name, 'bytes', data_length + index_length, 'rows', table_rows)) "
        "FROM information_schema.tables WHERE table_schema = 'mtgarchive';"
    ).strip() or "[]")
    data_dir = int(db("du -sb /var/lib/mysql | cut -f1").strip() or 0)
    binlog = db("ls /var/lib/mysql/binlog.[0-9]* >/dev/null 2>&1 && du -cb /var/lib/mysql/binlog.[0-9]* | tail -1 | cut -f1 || echo 0").strip()
    out = {
        "at": int(time.time() * 1000),
        "version": version,
        "status": status,
        "tables": tables,
        "dataDirBytes": data_dir,
        "binlogBytes": int(binlog or 0),
        "backupsBytes": du(os.path.join(STACK, "backups")),
        "dumpsBytes": du(os.path.join(STACK, "dumps")),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, OUT)


if __name__ == "__main__":
    main()
