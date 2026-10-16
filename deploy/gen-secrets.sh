#!/usr/bin/env bash
# Creates /opt/app/.env from env.production.example with every secret generated here, on the
# server (docs/DEPLOY.md, step 4). Run as deploy, once:
#
#   bash /opt/app/repo/deploy/gen-secrets.sh 203-0-113-10.sslip.io voce@exemplo.com
#
# Refuses to overwrite an existing .env. Prints the Dozzle password ONCE: store it, and then the
# whole .env, in the password manager.
set -euo pipefail

BASE_DOMAIN="${1:-}"
ACME_EMAIL="${2:-}"
TARGET="${TARGET:-/opt/app/.env}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "$BASE_DOMAIN" || -z "$ACME_EMAIL" ]]; then
  echo "Uso: gen-secrets.sh <dominio-base> <e-mail para o Let's Encrypt>" >&2
  echo "     ex.: gen-secrets.sh 203-0-113-10.sslip.io voce@exemplo.com" >&2
  exit 1
fi
if [[ -e "$TARGET" ]]; then
  echo "$TARGET já existe: nada foi alterado (para renovar um segredo, veja o roteiro de operação)." >&2
  exit 1
fi

# Hex and base64url only: no character that would need quoting in a URL or in the shell.
hex() { openssl rand -hex "$1"; }
b64url() { openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'; }

dozzle_password="$(b64url 18)"
# bcrypt hashes contain "$", which compose and the shell would read as variables: stored in
# base64, a format Caddy's basic_auth also accepts.
dozzle_hash="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$dozzle_password" |
  tr -d '\n' | base64 -w0)"

# Web Push (D049): P-256 pair in base64url (public = uncompressed point, private = d).
read -r vapid_public vapid_private < <(docker run --rm node:24-alpine node -e '
  const { generateKeyPairSync } = require("node:crypto");
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  const jwk = key.export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const pub = Buffer.concat([Buffer.from([4]), x, y]).toString("base64url");
  console.log(pub + " " + jwk.d);
')

umask 077
sed \
  -e "s|^BASE_DOMAIN=.*|BASE_DOMAIN=${BASE_DOMAIN}|" \
  -e "s|^ACME_EMAIL=.*|ACME_EMAIL=${ACME_EMAIL}|" \
  -e "s|^DB_OWNER_PASSWORD=.*|DB_OWNER_PASSWORD=$(hex 24)|" \
  -e "s|^DB_APP_PASSWORD=.*|DB_APP_PASSWORD=$(hex 24)|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(hex 24)|" \
  -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(b64url 48)|" \
  -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(b64url 48)|" \
  -e "s|^PLATFORM_JWT_SECRET=.*|PLATFORM_JWT_SECRET=$(b64url 48)|" \
  -e "s|^PLATFORM_SECRETS_KEY=.*|PLATFORM_SECRETS_KEY=$(b64url 32)|" \
  -e "s|^MENU_REVALIDATE_SECRET=.*|MENU_REVALIDATE_SECRET=$(b64url 32)|" \
  -e "s|^DOZZLE_PASSWORD_HASH=.*|DOZZLE_PASSWORD_HASH=${dozzle_hash}|" \
  -e "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=${vapid_public}|" \
  -e "s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=${vapid_private}|" \
  "$HERE/env.production.example" >"$TARGET"
chmod 600 "$TARGET"

echo "Criado: $TARGET (permissão 600)."
echo
echo "Senha do Dozzle (logs.${BASE_DOMAIN}, usuário admin), mostrada SÓ AGORA:"
echo "  ${dozzle_password}"
echo
echo "Falta preencher à mão (os <preencher> do arquivo): SMTP_USER, SMTP_PASSWORD,"
echo "MAIL_FROM_ADDRESS, NOMINATIM_EMAIL, BACKUP_AGE_RECIPIENT, BACKUP_REMOTE, HC_BACKUP_URL e"
echo "HC_MONITOR_URL. Depois, guarde o .env inteiro no gerenciador de senhas."
if grep -q '=<gerado>' "$TARGET"; then
  echo "ERRO: sobrou <gerado> em $TARGET" >&2
  exit 1
fi
