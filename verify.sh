#!/bin/bash
# radar 验收冒烟脚本（docs/design.md §10）。
# 隔离环境（临时 RADAR_DATA_DIR + mock fetcher + 独立端口）跑 curl 断言。
# 退出码 0 = 全绿。每次改动后必跑，作回归。
set -u
cd "$(dirname "$0")"

PORT=${VERIFY_PORT:-3210}
BASE="http://localhost:${PORT}/api/v1"
TMPDIR=$(mktemp -d /tmp/radar-verify-XXXXXX)
PASS=0
FAIL=0

log()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); log "  ok: $*"; }
fail() { FAIL=$((FAIL+1)); log "  FAIL: $*"; }

assert_eq() { # expected actual desc
  if [ "$1" = "$2" ]; then ok "$3"; else fail "$3 (expected=$1 actual=$2)"; fi
}

# ---------- 启动 server ----------
RADAR_DATA_DIR="$TMPDIR" RADAR_FETCHER=mock PORT=$PORT bun server/index.ts >"$TMPDIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$TMPDIR"' EXIT

for i in $(seq 1 50); do
  curl -sf "$BASE/accounts" >/dev/null 2>&1 && break
  sleep 0.2
done
if ! curl -sf "$BASE/accounts" >/dev/null 2>&1; then
  log "FATAL: server did not start; log:"
  tail -20 "$TMPDIR/server.log"
  exit 1
fi

log "== A1: 资源 API 信封与 selector =="
assert_eq "AccountList" "$(curl -s "$BASE/accounts" | jq -r .kind)" "accounts 列表信封"
assert_eq "radar/v1"    "$(curl -s "$BASE/accounts" | jq -r '.items[0].apiVersion')" "Account apiVersion"
assert_eq "zhihu-main"  "$(curl -s "$BASE/accounts/zhihu-main" | jq -r .metadata.name)" "单资源 GET"
assert_eq "404"         "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/accounts/nope")" "未知资源 404"
assert_eq "400"         "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/messages?labelSelector=bad")" "非法 selector 400"

log "== A2(mock): POST refreshwindows → Succeeded，档案落盘 =="
WIN=$(curl -s -X POST "$BASE/refreshwindows" -d '{"spec":{"source":"zhihu-main-recommend","count":10,"trigger":"manual"}}')
WIN_NAME=$(echo "$WIN" | jq -r .metadata.name)
assert_eq "Pending" "$(echo "$WIN" | jq -r .status.phase)" "创建即返回 Pending"
for i in $(seq 1 30); do
  PHASE=$(curl -s "$BASE/refreshwindows/$WIN_NAME" | jq -r .status.phase)
  [ "$PHASE" = "Succeeded" ] || [ "$PHASE" = "Failed" ] && break
  sleep 0.2
done
assert_eq "Succeeded" "$PHASE" "window 走到 Succeeded"
assert_eq "2" "$(curl -s "$BASE/refreshwindows/$WIN_NAME" | jq -r .status.stats.new)" "stats.new 正确"
if ls "$TMPDIR/windows/$WIN_NAME.json" >/dev/null 2>&1; then ok "档案落盘"; else fail "档案未落盘"; fi
# 同 source 再抓一轮 → 全部 duplicate
WIN2_NAME=$(curl -s -X POST "$BASE/refreshwindows" -d '{"spec":{"source":"zhihu-main-recommend"}}' | jq -r .metadata.name)
sleep 1
assert_eq "2" "$(curl -s "$BASE/refreshwindows/$WIN2_NAME" | jq -r .status.stats.duplicate)" "重复轮 stats.duplicate 正确"
assert_eq "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/refreshwindows" -d '{"spec":{"source":"nope"}}')" "未知 source 400"

log "== messages 查询 =="
curl -s -X POST "$BASE/refreshwindows" -d '{"spec":{"source":"twitter-main-following"}}' >/dev/null
sleep 1
assert_eq "4" "$(curl -s "$BASE/messages" | jq '.items | length')" "全量 messages = 4"
assert_eq "2" "$(curl -s "$BASE/messages?labelSelector=platform=zhihu" | jq '.items | length')" "labelSelector 过滤"
assert_eq "1" "$(curl -s "$BASE/messages?labelSelector=platform=zhihu&limit=1" | jq '.items | length')" "limit 生效"
assert_eq "zhihu-8002" "$(curl -s "$BASE/messages?labelSelector=platform=zhihu" | jq -r '.items[0].metadata.name')" "按时间倒序"
assert_eq "mock excerpt one" "$(curl -s "$BASE/messages/zhihu-8001" | jq -r .spec.text)" "单条 GET + normalize"
RAW_ID=$(curl -s "$BASE/messages/zhihu-8001" | jq -r .spec.raw.id)
assert_eq "8001" "$RAW_ID" "spec.raw 保留原始 payload"

log "== A9: author 归类地基 =="
assert_eq "2" "$(curl -s "$BASE/authors" | jq '.items | length')" "authors 注册表"
assert_eq "2" "$(curl -s "$BASE/authors/zhihu-mock-author" | jq -r .status.messageCount)" "messageCount 统计"
curl -s -X PATCH "$BASE/authors/zhihu-mock-author" -d '{"labels":{"category":"test-cat"}}' >/dev/null
assert_eq "test-cat" "$(curl -s "$BASE/authors/zhihu-mock-author" | jq -r .metadata.labels.category)" "PATCH author label（overlay）"
assert_eq "2" "$(curl -s "$BASE/messages?authorSelector=category=test-cat" | jq '.items | length')" "authorSelector 筛消息"
assert_eq "0" "$(curl -s "$BASE/messages?authorSelector=category=other" | jq '.items | length')" "authorSelector 不命中为空"
curl -s -X PATCH "$BASE/messages/zhihu-8001" -d '{"labels":{"starred":"true"}}' >/dev/null
assert_eq "true" "$(curl -s "$BASE/messages/zhihu-8001" | jq -r .metadata.labels.starred)" "PATCH message label（overlay）"

log "== 重启持久性：索引由档案+overlay 重建 =="
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
RADAR_DATA_DIR="$TMPDIR" RADAR_FETCHER=mock PORT=$PORT bun server/index.ts >>"$TMPDIR/server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 50); do curl -sf "$BASE/accounts" >/dev/null 2>&1 && break; sleep 0.2; done
assert_eq "4" "$(curl -s "$BASE/messages" | jq '.items | length')" "重启后 messages 恢复"
assert_eq "test-cat" "$(curl -s "$BASE/authors/zhihu-mock-author" | jq -r .metadata.labels.category)" "重启后 overlay 保留"

log ""
log "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && { log "ALL GREEN"; exit 0; } || exit 1
