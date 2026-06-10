#!/usr/bin/env bash
set -euo pipefail

SESSION="${SESSION:-refresh-k2}"
SERVER_PORT="${SERVER_PORT:-13001}"
WEB_PORT="${WEB_PORT:-13002}"
PUBLIC_URL="${PUBLIC_URL:-https://refresh-k2.woodgear.me}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"
mkdir -p data/logs

if [ ! -d node_modules ]; then
  bun install
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
fi

common='if [ -f ~/.env/.all.env ]; then set -a; source ~/.env/.all.env; set +a; fi'

tmux new-session -d -s "$SESSION" -n server -c "$ROOT" \
  "$common; PORT=$SERVER_PORT RADAR_BASE_URL=$PUBLIC_URL bun server/index.ts 2>&1 | tee -a data/logs/refresh-k2-server.log"

tmux new-window -t "$SESSION" -n web -c "$ROOT" \
  "$common; REFRESH_API_TARGET=http://127.0.0.1:$SERVER_PORT bunx vite --host 127.0.0.1 --port $WEB_PORT 2>&1 | tee -a data/logs/refresh-k2-web.log"

tmux list-windows -t "$SESSION"
