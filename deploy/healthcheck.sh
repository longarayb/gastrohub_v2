#!/usr/bin/env bash
# Health of the published apps (used by deploy.sh, rollback.sh and monitor.sh). Waits up to
# HEALTH_TIMEOUT seconds (default 120) for everything to answer; prints what failed.
set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/app/.env}"
BASE_DOMAIN="$(grep -E '^BASE_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
TIMEOUT="${HEALTH_TIMEOUT:-120}"
URLS=(
  "https://api.${BASE_DOMAIN}/api/health"
  "https://painel.${BASE_DOMAIN}/login"
  # Not /demo: on the first deploy the demo unit does not exist yet.
  "https://cardapio.${BASE_DOMAIN}/robots.txt"
  "https://admin.${BASE_DOMAIN}/login"
  # The panel reaches the API through its own address (the proxy).
  "https://painel.${BASE_DOMAIN}/api/health"
)

deadline=$((SECONDS + TIMEOUT))
while :; do
  failed=()
  for url in "${URLS[@]}"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)"
    [[ "$code" == 200 ]] || failed+=("$url -> ${code:-sem resposta}")
  done
  if ((${#failed[@]} == 0)); then
    echo "  saúde ok (${#URLS[@]} endereços)"
    exit 0
  fi
  if ((SECONDS >= deadline)); then
    printf '  FALHOU: %s\n' "${failed[@]}"
    exit 1
  fi
  sleep 5
done
