#!/usr/bin/env bash
# Daily backup (systemd timer app-backup, 03:30 Brasília; docs/DEPLOY.md, "Backups"). As root.
#
#   - database (pg_dump), users and permissions (pg_dumpall --globals-only), uploaded images and
#     the server configuration (Postgres, Caddyfile, compose, systemd), each encrypted with age
#     (only the PUBLIC key is on the server)
#   - sent with rclone to <BACKUP_REMOTE>/daily/<date>/, plus weekly/ on Sundays and monthly/ on
#     the 1st: the bucket's lifecycle rules keep 7 daily, 4 weekly and 6 monthly (the server's key
#     cannot delete)
#   - Healthchecks.io is pinged at the start and at the end (or with the error)
# The .env is NOT in the backup: it lives in the password manager.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/app/.env}"
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"
load_env "$ENV_FILE"
: "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_REMOTE:?}"

ping_hc() { [[ -n "${HC_BACKUP_URL:-}" ]] && curl -fsS -m 10 --retry 3 --data-raw "${2:-}" "${HC_BACKUP_URL}$1" >/dev/null || true; }
LOG="$(mktemp)"
fail() {
  ping_hc /fail "$(tail -n 20 "$LOG")"
  echo "Backup FALHOU" >&2
  tail -n 20 "$LOG" >&2
}
trap fail ERR
exec > >(tee -a "$LOG") 2>&1
ping_hc /start

DATE="$(TZ=America/Sao_Paulo date +%Y-%m-%d)"
WORK="/mnt/dados/backups/tmp/$DATE"
rm -rf "$WORK"
install -d -m 700 "$WORK"
enc() { age -r "$BACKUP_AGE_RECIPIENT" -o "$1"; }

echo "Banco"
sudo -u postgres pg_dump -Fc app_db | enc "$WORK/app_db.dump.age"
sudo -u postgres pg_dumpall --globals-only --no-role-passwords | enc "$WORK/globals.sql.age"

echo "Imagens enviadas"
tar -C /mnt/dados -czf - uploads | enc "$WORK/uploads.tar.gz.age"

echo "Configuração do servidor"
tar -czf - --ignore-failed-read \
  /etc/postgresql/17/main \
  /etc/systemd/system/postgresql@17-main.service.d \
  /opt/app/compose.prod.yml /opt/app/Caddyfile /opt/app/state \
  2>/dev/null | enc "$WORK/config.tar.gz.age"

sha256sum "$WORK"/*.age | sed "s|$WORK/||" >"$WORK/SHA256SUMS"

echo "Envio para $BACKUP_REMOTE"
rclone copy --immutable "$WORK" "$BACKUP_REMOTE/daily/$DATE"
[[ "$(TZ=America/Sao_Paulo date +%u)" == 7 ]] && rclone copy --immutable "$WORK" "$BACKUP_REMOTE/weekly/$DATE"
[[ "$(TZ=America/Sao_Paulo date +%d)" == 01 ]] && rclone copy --immutable "$WORK" "$BACKUP_REMOTE/monthly/$DATE"
rclone check --one-way "$WORK" "$BACKUP_REMOTE/daily/$DATE"

size="$(du -sh "$WORK" | cut -f1)"
rm -rf "$WORK"
trap - ERR
ping_hc "" "ok: $DATE, $size"
echo "Backup $DATE enviado ($size)."
