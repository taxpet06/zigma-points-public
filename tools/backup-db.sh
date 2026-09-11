#!/usr/bin/env bash
# Local snapshot of the Neon database. Usage: tools/backup-db.sh [.env.production]
#
# ONE file per environment, overwritten every run — no dated filenames, no rotation.
# This is a "latest known-good state" snapshot, not an archive: keeping fourteen of
# them was fourteen copies of the same database on a laptop.
# Cron:  0 3 * * * mkdir -p /home/petros/Github/zigma-points/backups && /home/petros/Github/zigma-points/tools/backup-db.sh >> /home/petros/Github/zigma-points/backups/backup.log 2>&1
#        (the mkdir matters: the shell opens that redirect before this script runs, so on
#         a fresh checkout the job would fail silently until backups/ exists)
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${1:-.env.production}"

set -a; . "./$ENV_FILE"; set +a
mkdir -p backups

TAG="$(basename "$ENV_FILE" | sed 's/^\.env\.//')"
OUT="backups/zigma-$TAG.dump"

# -Fc = compressed custom format, restore with pg_restore. DIRECT_URL is the
# unpooled endpoint; pg_dump can't use the pgbouncer pooler.
trap 'rm -f "$OUT.tmp"' EXIT

pg_dump "$DIRECT_URL" -Fc --no-owner --no-privileges -f "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "$(date -Is) ok $OUT ($(du -h "$OUT" | cut -f1))"

# One-time cleanup of the old dated snapshots this script used to leave behind. The
# `mv` above already replaced the single current file; this only sweeps the previous
# naming scheme, and is a no-op once it has run.
rm -f "backups/zigma-$TAG-"*.dump
