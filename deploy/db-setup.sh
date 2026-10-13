#!/usr/bin/env bash
# Database users and database (docs/DEPLOY.md, step 5), with the passwords of /opt/app/.env.
# Run as root after gen-secrets.sh. Re-runnable (also renews the passwords from the .env).
#
#   app_owner  owns app_db and its tables: used only by the migrations
#   app        data only (SELECT, INSERT, UPDATE, DELETE): used by the API
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/app/.env}"
# PSQL: how to reach the server as superuser (default: the postgres user of this VM). The local
# rehearsal points it to a container: PSQL="docker exec -i pg psql -U postgres".
PSQL="${PSQL:-sudo -u postgres psql}"
if [[ "$PSQL" == sudo* ]]; then
  [[ $EUID -eq 0 ]] || { echo "rode como root" >&2; exit 1; }
fi
[[ -r "$ENV_FILE" ]] || { echo "não achei $ENV_FILE (rode gen-secrets.sh antes)" >&2; exit 1; }
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"
load_env "$ENV_FILE"
: "${DB_OWNER_PASSWORD:?}" "${DB_APP_PASSWORD:?}"

# shellcheck disable=SC2086 # PSQL is a command with its arguments
psql() { $PSQL -X -v ON_ERROR_STOP=1 -q "$@"; }

psql -v owner_pw="$DB_OWNER_PASSWORD" -v app_pw="$DB_APP_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE app_owner LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner')
\gexec
SELECT 'CREATE ROLE app LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app')
\gexec
ALTER ROLE app_owner WITH LOGIN PASSWORD :'owner_pw';
ALTER ROLE app WITH LOGIN PASSWORD :'app_pw';
SELECT 'CREATE DATABASE app_db OWNER app_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'app_db')
\gexec
SQL

psql -d app_db <<'SQL'
-- Nobody else creates objects in public; the owner of the schema is app_owner.
ALTER SCHEMA public OWNER TO app_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app;
-- What exists now (re-run after a restore) and what the migrations create later.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app;
SQL

echo "Banco app_db pronto: app_owner (migrations) e app (API)."
