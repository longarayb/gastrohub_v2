#!/usr/bin/env bash
# Installs and starts the scheduled jobs (docs/DEPLOY.md, step 9). As root, after the .env is
# complete (backup and monitoring use its B2, age and Healthchecks settings):
#
#   bash /opt/app/repo/deploy/install-timers.sh
#
# Times in Brasília (the server clock is UTC): backup 03:30, demo reset 04:00, monitoring every
# 5 minutes. Updates run at 04:15 and a needed reboot at 04:30 (server-setup.sh).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "rode como root" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
install -m 644 "$HERE"/systemd/app-*.service "$HERE"/systemd/app-*.timer /etc/systemd/system/
systemctl daemon-reload
for t in app-backup app-demo-reset app-monitor; do systemctl enable --now "$t.timer"; done
systemctl list-timers 'app-*' 'apt-daily-upgrade*' --no-pager
