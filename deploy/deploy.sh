#!/usr/bin/env bash
# Publishes a version (docs/DEPLOY.md, "Publicar uma versão"). Run as deploy on the server:
#
#   bash /opt/app/repo/deploy/deploy.sh <commit>     e.g. deploy.sh 3f2c1ab (from the Actions run)
#
#  1. quick database backup (kept in /mnt/dados/backups/pre-deploy, last 5)
#  2. pull the images of that commit
#  3. migrations in a one-off container (owner of the tables), before the apps change
#  4. start the new version
#  5. health check (API and the 4 addresses over HTTPS)
#  6. on failure, back to the previous version by itself
set -euo pipefail

VERSION="${1:-}"
APP=/opt/app
STATE="$APP/state"
COMPOSE=(docker compose --project-name app -f "$APP/compose.prod.yml" --env-file "$APP/.env")
log() { printf '\n\033[1m[deploy] %s\033[0m\n' "$*"; }

[[ -n "$VERSION" ]] || { echo "Uso: deploy.sh <commit>" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9a-f]{7,40}$ || "$VERSION" == main ]] || { echo "versão inválida: $VERSION" >&2; exit 1; }
mkdir -p "$STATE"
PREVIOUS="$(cat "$STATE/current" 2>/dev/null || true)"

# The compose file and the Caddyfile come from the repository of that version.
log "Arquivos de produção da versão $VERSION"
git -C "$APP/repo" fetch -q --depth 1 origin "$VERSION" 2>/dev/null || git -C "$APP/repo" fetch -q origin
git -C "$APP/repo" -c advice.detachedHead=false checkout -q "${VERSION}" 2>/dev/null ||
  git -C "$APP/repo" -c advice.detachedHead=false checkout -q FETCH_HEAD
install -m 644 "$APP/repo/deploy/compose.prod.yml" "$APP/compose.prod.yml"
install -m 644 "$APP/repo/deploy/Caddyfile" "$APP/Caddyfile"

set_version() { sed -i "s|^APP_VERSION=.*|APP_VERSION=$1|" "$APP/.env"; }

log "1/5 Backup rápido do banco"
mkdir -p /mnt/dados/backups/pre-deploy 2>/dev/null || sudo install -d -m 700 -o deploy /mnt/dados/backups/pre-deploy
dump="/mnt/dados/backups/pre-deploy/$(date -u +%Y%m%dT%H%M%SZ)-before-${VERSION}.dump"
sudo -u postgres pg_dump -Fc app_db | sudo tee "$dump" >/dev/null
sudo chmod 600 "$dump"
# shellcheck disable=SC2012
ls -1t /mnt/dados/backups/pre-deploy/*.dump | tail -n +6 | xargs -r sudo rm -f
echo "  $dump"

set_version "$VERSION"
log "2/5 Baixando as imagens"
"${COMPOSE[@]}" pull --quiet api web menu admin
"${COMPOSE[@]}" --profile tools pull --quiet migrate

log "3/5 Migrations"
"${COMPOSE[@]}" --profile tools run --rm migrate

log "4/5 Subindo a versão $VERSION"
"${COMPOSE[@]}" up -d --remove-orphans

log "5/5 Conferindo a saúde"
if bash "$APP/repo/deploy/healthcheck.sh"; then
  echo "$VERSION" >"$STATE/current"
  [[ -n "$PREVIOUS" && "$PREVIOUS" != "$VERSION" ]] && echo "$PREVIOUS" >"$STATE/previous"
  log "Versão $VERSION no ar."
else
  log "FALHOU: voltando para ${PREVIOUS:-nenhuma (primeiro deploy)}"
  if [[ -n "$PREVIOUS" ]]; then
    set_version "$PREVIOUS"
    "${COMPOSE[@]}" up -d --remove-orphans
    bash "$APP/repo/deploy/healthcheck.sh" || true
    echo "A migration desta versão já rodou. Se a versão anterior não funcionar com ela, restaure o backup:"
    echo "  $dump   (roteiro de operação, 'Voltar o banco')"
  fi
  exit 1
fi
