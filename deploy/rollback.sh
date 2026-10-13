#!/usr/bin/env bash
# Back to the previous version (docs/DEPLOY.md, "Voltar uma versão"). Run as deploy:
#
#   bash /opt/app/repo/deploy/rollback.sh            the version before the current one
#   bash /opt/app/repo/deploy/rollback.sh <commit>   a given version
#
# Only the apps go back: migrations only move forward. If the old version does not work with the
# current database, restore the pre-deploy backup (roteiro de operação, "Voltar o banco").
set -euo pipefail

APP=/opt/app
STATE="$APP/state"
TARGET="${1:-$(cat "$STATE/previous" 2>/dev/null || true)}"
CURRENT="$(cat "$STATE/current" 2>/dev/null || true)"
[[ -n "$TARGET" ]] || { echo "Não há versão anterior registrada; informe o commit." >&2; exit 1; }

echo "Voltando de ${CURRENT:-?} para $TARGET"
sed -i "s|^APP_VERSION=.*|APP_VERSION=$TARGET|" "$APP/.env"
docker compose --project-name app -f "$APP/compose.prod.yml" --env-file "$APP/.env" pull --quiet api web menu admin
docker compose --project-name app -f "$APP/compose.prod.yml" --env-file "$APP/.env" up -d --remove-orphans
if bash "$APP/repo/deploy/healthcheck.sh"; then
  echo "$TARGET" >"$STATE/current"
  [[ -n "$CURRENT" ]] && echo "$CURRENT" >"$STATE/previous"
  echo "Versão $TARGET no ar."
else
  echo "A versão $TARGET também não respondeu: veja os logs (logs.<base> ou docker compose logs)." >&2
  exit 1
fi
