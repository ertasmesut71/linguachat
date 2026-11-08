#!/bin/bash
# ═══════════════════════════════════════════════
# LinguaChat — Deployment Smoke Test
#
# Run after: docker compose build && docker compose up -d
#
# Verifies:
#   1. nginx container has built frontend files
#   2. SPA routes return 200
#   3. API health endpoint works through nginx
#   4. Static assets load
# ═══════════════════════════════════════════════

set -e

BASE_URL="${1:-http://localhost}"
NGINX_CONTAINER="${2:-linguachat-nginx-1}"

echo "═══ LinguaChat Deployment Smoke Test ═══"
echo "Base URL: $BASE_URL"
echo ""

# 1. Verify nginx container has frontend files
echo "── 1. Checking nginx container filesystem ──"
if docker compose exec nginx ls /usr/share/nginx/html/index.html > /dev/null 2>&1; then
  echo "✓ index.html exists in nginx container"
else
  echo "✗ FAIL: index.html NOT found in nginx container at /usr/share/nginx/html/"
  echo "  Run: docker compose build nginx --no-cache"
  exit 1
fi

ASSET_COUNT=$(docker compose exec nginx ls /usr/share/nginx/html/assets/ 2>/dev/null | wc -l)
echo "✓ $ASSET_COUNT asset files in /usr/share/nginx/html/assets/"

# 2. HTTP smoke tests
echo ""
echo "── 2. HTTP Smoke Tests ──"

check_url() {
  local path="$1"
  local desc="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$path" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    echo "✓ GET $path → $status ($desc)"
  else
    echo "✗ FAIL: GET $path → $status ($desc)"
    return 1
  fi
}

check_url "/" "Frontend root"
check_url "/login" "SPA route /login"
check_url "/register" "SPA route /register"
check_url "/api/health" "API health endpoint"

# 3. Verify frontend is LinguaChat (not nginx default)
echo ""
echo "── 3. Content verification ──"
BODY=$(curl -s "$BASE_URL/" 2>/dev/null || echo "")
if echo "$BODY" | grep -qi "linguachat\|vite\|root"; then
  echo "✓ Frontend content is LinguaChat (not nginx default page)"
else
  echo "✗ WARNING: Frontend may be nginx default page"
fi

# 4. WebSocket upgrade config check
echo ""
echo "── 4. WebSocket config ──"
if docker compose exec nginx cat /etc/nginx/nginx.conf 2>/dev/null | grep -q "proxy_set_header Upgrade"; then
  echo "✓ WebSocket upgrade headers configured"
else
  echo "✗ WARNING: WebSocket upgrade headers may be missing"
fi

echo ""
echo "═══ Smoke test complete ═══"
