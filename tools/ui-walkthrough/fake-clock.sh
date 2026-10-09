#!/usr/bin/env bash
# Simulated clock for the walkthroughs (Linux/WSL), e.g. late at night after the demo unit
# closes (docs/SETUP.md, "Relógio simulado"). Uses libfaketime from the Ubuntu package,
# extracted without sudo into ~/.local/faketime on the first run.
#
#   tools/ui-walkthrough/fake-clock.sh "2026-10-13 23:40" pnpm start:lite --menu
#
# Use a moment in the FUTURE: the digital menu cache (Next) mixes the simulated wall clock with
# the real monotonic one, and only a clock ahead of the real one keeps its refreshes working.
#   tools/ui-walkthrough/fake-clock.sh same pnpm --filter @app/api db:seed
#   tools/ui-walkthrough/fake-clock.sh same node tools/ui-walkthrough/pos.mjs
#
# The offset is saved on the first call ("same" reuses it), so the API, the seed and the
# walkthroughs agree. Run the seed with --filter: Turborepo drops unknown environment
# variables. The browser gets the same offset from browser.mjs. Postgres keeps the real
# clock (SQL now() is not simulated).
set -euo pipefail
LIB="$HOME/.local/faketime/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1"
if [ ! -f "$LIB" ]; then
  tmp=$(mktemp -d)
  (cd "$tmp" && apt-get download libfaketime >/dev/null && mkdir -p "$HOME/.local/faketime" &&
    dpkg -x libfaketime_*.deb "$HOME/.local/faketime")
  rm -rf "$tmp"
fi
TARGET="$1"
shift
OFFSET_FILE="${TMPDIR:-/tmp}/app-fake-clock-offset"
if [ "$TARGET" != "same" ]; then
  echo $(($(TZ=America/Sao_Paulo date -d "$TARGET" +%s) - $(date +%s))) >"$OFFSET_FILE"
fi
OFFSET=$(cat "$OFFSET_FILE")
[ "${OFFSET#-}" = "$OFFSET" ] && OFFSET="+$OFFSET" # libfaketime wants the sign
export LD_PRELOAD="$LIB"
export FAKETIME="${OFFSET}s"
# Timers keep the real monotonic clock (shifting it disturbs Node). Next stamps its cache with
# it, so a FUTURE moment keeps cache refreshes working (the refresh time is always newer).
export FAKETIME_DONT_FAKE_MONOTONIC=1
echo "[app] relógio simulado: $(TZ=America/Sao_Paulo date)" >&2
exec "$@"
