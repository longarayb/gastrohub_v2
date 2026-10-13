#!/usr/bin/env bash
# Local rehearsal of production (before touching the server): the real compose.prod.yml, Caddy,
# gen-secrets.sh and db-setup.sh, with *.localhost addresses (Caddy's own certificates) and a
# Postgres CONTAINER standing in for the one on the VM. Needs the images built locally:
#
#   docker build -f docker/api.Dockerfile -t local/app-api:test .
#   docker build -f docker/next.Dockerfile --build-arg APP=web --build-arg NEXT_PUBLIC_API_URL= \
#     --build-arg NEXT_PUBLIC_MENU_URL= -t local/app-web:test .        (and menu, admin)
#   bash deploy/local-check.sh          rehearsal, then everything is removed
#   KEEP=1 bash deploy/local-check.sh   leaves it running (https://painel.localhost:8443)
#
# Checks: migrations as the owner, the API as a data-only user (cannot create tables), each app
# calling /api on its own address (login, refresh cookie, Socket.IO through the proxy), the demo
# reset and demo mode, and the API refusing a development secret.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HOME/app-prodtest}"
PG=prodtest-pg
PROJECT=prodtest
PORT=8443
pass=0
failures=()
ok() { pass=$((pass + 1)); echo "  ok  $*"; }
bad() { failures+=("$*"); echo "  FALHOU  $*"; }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }

compose() {
  docker compose --project-name "$PROJECT" -f "$WORK/compose.prod.yml" -f "$WORK/local.yml" \
    --env-file "$WORK/.env" "$@"
}
teardown() {
  compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$PG" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
host() { echo "$1.localhost"; }
# curl to Caddy on 127.0.0.1:8443 with the real host name (certificates from Caddy's own CA).
web() {
  local h="$1"
  shift
  curl -sk --resolve "$h:$PORT:127.0.0.1" "$@"
}

teardown
mkdir -p "$WORK/uploads"
cp "$ROOT/deploy/compose.prod.yml" "$ROOT/deploy/Caddyfile" "$WORK/"

echo "== Rede app_net e Postgres em container (no servidor ele roda na VM)"
docker network inspect app_net >/dev/null 2>&1 ||
  docker network create --subnet 172.30.0.0/24 --gateway 172.30.0.1 app_net >/dev/null
docker run -d --name "$PG" --network app_net --ip 172.30.0.10 -e POSTGRES_PASSWORD=local-rehearsal \
  postgres:17-alpine >/dev/null
until docker exec "$PG" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
sleep 2

echo "== gen-secrets.sh e db-setup.sh"
secrets_out="$(TARGET="$WORK/.env" bash "$ROOT/deploy/gen-secrets.sh" localhost local@example.com)" ||
  { echo "gen-secrets falhou"; exit 1; }
# The Dozzle password is printed once, on the line after "mostrada SÓ AGORA".
dozzle_password="$(grep -A1 'SÓ AGORA' <<<"$secrets_out" | tail -1 | tr -d ' ')"
sed -i \
  -e 's|@172.30.0.1:5432|@172.30.0.10:5432|' \
  -e 's|^IMAGE_PREFIX=.*|IMAGE_PREFIX=local|' \
  -e 's|^APP_VERSION=.*|APP_VERSION=test|' \
  -e 's|^SMTP_USER=.*|SMTP_USER=ensaio|' \
  -e 's|^SMTP_PASSWORD=.*|SMTP_PASSWORD=ensaio|' \
  -e 's|^MAIL_FROM_ADDRESS=.*|MAIL_FROM_ADDRESS=ensaio@example.com|' \
  -e 's|^NOMINATIM_EMAIL=.*|NOMINATIM_EMAIL=ensaio@example.com|' \
  -e 's|^GEOCODING_PROVIDER=.*|GEOCODING_PROVIDER=none|' \
  -e 's|^LOGIN_RATE_LIMIT_PER_MINUTE=.*|LOGIN_RATE_LIMIT_PER_MINUTE=100|' \
  "$WORK/.env"
ENV_FILE="$WORK/.env" PSQL="docker exec -i $PG psql -U postgres" bash "$ROOT/deploy/db-setup.sh" ||
  { echo "db-setup falhou"; exit 1; }

# Local differences only: uploads folder, Caddy on 8080/8443.
cat >"$WORK/local.yml" <<EOF
services:
  api:
    volumes: !override
      - $WORK/uploads:/data/uploads
  caddy:
    ports: !override
      - '8080:80'
      - '$PORT:443'
EOF
sudo_chown() { docker run --rm -v "$WORK/uploads:/u" alpine:3.20 chown 1000:1000 /u; }
sudo_chown

echo "== Migrations (dono das tabelas) e subida"
compose --profile tools run --rm migrate >"$WORK/migrate.log" 2>&1 && ok "migrations como app_owner" ||
  { bad "migrations"; tail -20 "$WORK/migrate.log"; }
compose up -d >/dev/null 2>&1
for _ in $(seq 1 60); do
  [[ "$(web "$(host api)" -o /dev/null -w '%{http_code}' "https://$(host api):$PORT/api/health")" == 200 ]] && break
  sleep 3
done

echo "== Endereços (Caddy)"
check "API em api.localhost" "[[ \$(web $(host api) -o /dev/null -w '%{http_code}' https://$(host api):$PORT/api/health) == 200 ]]"
check "painel.localhost/login" "[[ \$(web $(host painel) -o /dev/null -w '%{http_code}' https://$(host painel):$PORT/login) == 200 ]]"
check "painel.localhost/api/health (API pelo endereço do painel)" "[[ \$(web $(host painel) -o /dev/null -w '%{http_code}' https://$(host painel):$PORT/api/health) == 200 ]]"
check "admin.localhost/login" "[[ \$(web $(host admin) -o /dev/null -w '%{http_code}' https://$(host admin):$PORT/login) == 200 ]]"
check "cardapio.localhost/robots.txt" "[[ \$(web $(host cardapio) -o /dev/null -w '%{http_code}' https://$(host cardapio):$PORT/robots.txt) == 200 ]]"
check "o build do painel não contém localhost:3333" "! docker exec ${PROJECT}-web-1 grep -rlq 'localhost:3333' /app/apps/web/.next/static"
check "a rota interna /api/revalidate do cardápio não é alcançável de fora" "[[ \$(web $(host cardapio) -o /dev/null -w '%{http_code}' -X POST https://$(host cardapio):$PORT/api/revalidate) != 200 ]]"
logs_code() { web "$(host logs)" -o /dev/null -w '%{http_code}' "$@" "https://$(host logs):$PORT/"; }
[[ "$(logs_code)" == 401 ]] && ok "logs.localhost pede senha (Dozzle)" || bad "logs.localhost sem senha: $(logs_code)"
[[ "$(logs_code -u "admin:$dozzle_password")" == 200 ]] &&
  ok "logs.localhost abre com a senha gerada (hash em base64 no Caddy)" ||
  bad "logs.localhost com a senha gerada: $(logs_code -u "admin:$dozzle_password")"

echo "== Demonstração (demo-reset) e modo demonstração"
compose run --rm --no-deps api node dist/cli/demo-reset.js --yes >"$WORK/demo.log" 2>&1 &&
  ok "demo-reset: $(tail -1 "$WORK/demo.log")" || { bad "demo-reset"; tail -20 "$WORK/demo.log"; }
check "cardapio.localhost/demo" "[[ \$(web $(host cardapio) -o /dev/null -w '%{http_code}' https://$(host cardapio):$PORT/demo) == 200 ]]"

jar="$WORK/cookies.txt"
login="$(web "$(host painel)" -c "$jar" -H 'content-type: application/json' \
  -d '{"email":"dono@demo.local","password":"Demo1234"}' "https://$(host painel):$PORT/api/auth/login")"
token="$(echo "$login" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
[[ -n "$token" ]] && ok "login pelo endereço do painel" || bad "login: $login"
check "cookie de sessão Secure e só do painel" "grep -q 'painel.localhost.*TRUE.*app_refresh' '$jar'"
check "renovação da sessão pelo cookie (mesmo endereço)" "web $(host painel) -b '$jar' -X POST https://$(host painel):$PORT/api/auth/refresh | grep -q accessToken"
check "faixa de demonstração" "web $(host painel) -H 'authorization: Bearer $token' https://$(host painel):$PORT/api/stores/current/notices | grep -q '\"demoMode\":true'"
check "modo demonstração bloqueia trocar o nome da empresa" "web $(host painel) -X PATCH -H 'authorization: Bearer $token' -H 'content-type: application/json' -d '{\"tradeName\":\"x\"}' https://$(host painel):$PORT/api/stores/current | grep -q DEMO_MODE"
check "Socket.IO pelo endereço do painel (proxy)" "web $(host painel) 'https://$(host painel):$PORT/socket.io/?EIO=4&transport=polling' | grep -q '\"sid\"'"

echo "== Banco: o usuário da API não altera a estrutura"
app_url="$(grep -E '^DATABASE_URL=' "$WORK/.env" | cut -d= -f2- | sed "s/\${DB_APP_PASSWORD}/$(grep -E '^DB_APP_PASSWORD=' "$WORK/.env" | cut -d= -f2-)/" | sed 's/?schema=public//')"
check "app não cria tabela" "! docker exec $PG psql '$app_url' -c 'CREATE TABLE intruso (id int)'"
check "app lê e grava dados" "docker exec $PG psql '$app_url' -tAc 'SELECT count(*) FROM \"Order\"'"

echo "== Produção recusa segredo de desenvolvimento"
refused="$(
  # shellcheck source=deploy/lib.sh
  . "$ROOT/deploy/lib.sh"
  load_env "$WORK/.env"
  docker run --rm --network app_net -e NODE_ENV=production -e DATABASE_URL \
    -e JWT_ACCESS_SECRET=dev-only-access-secret-change-me-please -e JWT_REFRESH_SECRET \
    -e PLATFORM_JWT_SECRET -e PLATFORM_SECRETS_KEY -e MENU_REVALIDATE_SECRET -e API_PUBLIC_URL \
    -e WEB_PUBLIC_URL -e MENU_PUBLIC_URL -e ADMIN_PUBLIC_URL -e SMTP_TLS \
    "local/app-api:${APP_VERSION}" 2>&1
)"
if grep -q 'Configuração de produção recusada' <<<"$refused" && grep -q JWT_ACCESS_SECRET <<<"$refused"; then
  ok "API recusa JWT de desenvolvimento"
else
  bad "API recusa JWT de desenvolvimento: $(tail -3 <<<"$refused")"
fi

echo
echo "Resultado: $pass ok, ${#failures[@]} com problema"
((${#failures[@]})) && printf '  - %s\n' "${failures[@]}"
if [[ -n "${KEEP:-}" ]]; then
  echo "Ensaio no ar (KEEP=1): https://painel.localhost:$PORT (certificado da CA local do Caddy)."
else
  teardown
fi
((${#failures[@]} == 0))
