#!/usr/bin/env bash
# Every 5 minutes (systemd timer app-monitor; docs/DEPLOY.md, "Monitoramento"). As root.
# Pings Healthchecks.io with "ok" or with what is wrong. If the VM goes down, the pings stop and
# Healthchecks sends the e-mail by itself.
set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/app/.env}"
HC="$(grep -E '^HC_MONITOR_URL=' "$ENV_FILE" | cut -d= -f2-)"
problems=()

out="$(HEALTH_TIMEOUT=20 bash /opt/app/repo/deploy/healthcheck.sh 2>&1)" || problems+=("apps: $out")
pg_isready -q -h 172.30.0.1 -p 5432 || problems+=("Postgres não aceita conexão em 172.30.0.1")
for mount in / /mnt/dados; do
  used="$(df --output=pcent "$mount" | tail -1 | tr -dc '0-9')"
  ((used > 80)) && problems+=("disco $mount em ${used}%")
done
mem="$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "%d", (t-a)*100/t}' /proc/meminfo)"
((mem > 90)) && problems+=("memória em ${mem}%")
load="$(cut -d' ' -f1 /proc/loadavg)"
cpus="$(nproc)"
awk -v l="$load" -v c="$cpus" 'BEGIN {exit !(l > c * 2)}' && problems+=("carga ${load} (${cpus} CPUs)")

if ((${#problems[@]} == 0)); then
  [[ -n "$HC" ]] && curl -fsS -m 10 --retry 3 --data-raw "ok; disco/memória/carga normais" "$HC" >/dev/null
else
  msg="$(printf '%s\n' "${problems[@]}")"
  echo "$msg" >&2
  [[ -n "$HC" ]] && curl -fsS -m 10 --retry 3 --data-raw "$msg" "$HC/fail" >/dev/null
  exit 1
fi
