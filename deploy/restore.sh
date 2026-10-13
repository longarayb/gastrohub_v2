#!/usr/bin/env bash
# Restore TEST (docs/DEPLOY.md, "Teste de restauração"; monthly). As root:
#
#   bash restore.sh /dev/shm/backup-key.txt [AAAA-MM-DD]
#
# The age PRIVATE key comes from the password manager into a file in /dev/shm (memory) and is
# erased at the end. Downloads the backup (default: the latest daily), decrypts, restores the
# database into app_restore_test (dropped at the end), compares counts with the live database
# and checks that the images open. Never touches app_db. The result goes to
# /opt/app/state/restore-tests.log.
#
# A real restore (disaster) is in the operations guide: same files, into app_db, with the apps
# stopped.
set -euo pipefail

KEY="${1:-}"
DATE="${2:-}"
ENV_FILE="${ENV_FILE:-/opt/app/.env}"
[[ -r "$KEY" ]] || { echo "Uso: restore.sh <arquivo da chave privada age> [AAAA-MM-DD]" >&2; exit 1; }
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"
load_env "$ENV_FILE"

WORK="$(mktemp -d /mnt/dados/backups/restore-test.XXXXXX)"
cleanup() {
  sudo -u postgres dropdb --if-exists app_restore_test || true
  rm -rf "$WORK"
  shred -u "$KEY" 2>/dev/null || rm -f "$KEY"
}
trap cleanup EXIT

if [[ -z "$DATE" ]]; then
  DATE="$(rclone lsf --dirs-only "$BACKUP_REMOTE/daily/" | sort | tail -n 1 | tr -d '/')"
fi
echo "Backup de $DATE"
rclone copy "$BACKUP_REMOTE/daily/$DATE" "$WORK"
(cd "$WORK" && sha256sum -c SHA256SUMS)

age -d -i "$KEY" -o "$WORK/app_db.dump" "$WORK/app_db.dump.age"
sudo -u postgres dropdb --if-exists app_restore_test
sudo -u postgres createdb app_restore_test
chmod 644 "$WORK/app_db.dump"
sudo -u postgres pg_restore --no-owner --no-privileges -d app_restore_test "$WORK/app_db.dump"

count() { sudo -u postgres psql -XtAq -d "$1" -c "SELECT count(*) FROM \"$2\""; }
report=""
for table in Order Customer Product Store PlatformInvoice; do
  restored="$(count app_restore_test "$table")"
  live="$(count app_db "$table")"
  report+="$table: backup $restored, agora $live; "
done
echo "$report"

age -d -i "$KEY" "$WORK/uploads.tar.gz.age" | tar -C "$WORK" -xzf -
images="$(find "$WORK/uploads" -type f | wc -l)"
bad=0
while IFS= read -r f; do
  file -b --mime-type "$f" | grep -q '^image/' || bad=$((bad + 1))
done < <(find "$WORK/uploads" -type f | head -n 50)
echo "Imagens: $images arquivos; amostra de até 50 conferida, $bad não abrem como imagem"

result="$(date -u +%FT%TZ) backup $DATE: $report imagens $images (ruins na amostra: $bad)"
install -d -o deploy -g deploy /opt/app/state
echo "$result" >>/opt/app/state/restore-tests.log
((bad == 0)) && echo "TESTE DE RESTAURAÇÃO OK" || { echo "TESTE COM PROBLEMAS" >&2; exit 1; }
