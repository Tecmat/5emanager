#!/usr/bin/env bash
# Smoke test di un deploy 5e Manager (LAN o HTTPS): controlla che web app, API e WebSocket rispondano.
# Uso:  ./deploy/smoke-test.sh https://dnd.tuosito.it     (oppure http://192.168.1.10:3001)
set -u
BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "uso: $0 <base-url>   es. $0 https://dnd.tuosito.it  oppure  $0 http://192.168.1.10:3001"
  exit 2
fi
BASE="${BASE%/}"
fail=0
check() { # nome, url, pattern atteso (-L segue i redirect: primo avvio -> /setup, non loggato -> /login)
  local name="$1" url="$2" pattern="$3"
  local body code
  body=$(curl -fsSL --max-time 10 "$url" 2>/dev/null); code=$?
  if [ $code -ne 0 ]; then
    echo "FAIL $name: $url non risponde (curl exit $code)"; fail=1; return
  fi
  if [ -n "$pattern" ] && ! printf '%s' "$body" | grep -qE "$pattern"; then
    echo "FAIL $name: risposta senza '$pattern': $(printf '%s' "$body" | head -c 200)"; fail=1; return
  fi
  echo "ok   $name ($url)"
}

check "web app (index)"      "$BASE/"            '<html|<!DOCTYPE'
check "version.json"         "$BASE/version.json" '"version"'
check "API info"             "$BASE/api/info"     '"ok"|"port"|lan'
check "pannello admin"       "$BASE/admin"        '<html|<!DOCTYPE'

# WebSocket handshake: ci aspettiamo HTTP 101 Switching Protocols
hs=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(head -c 16 /dev/urandom | base64)" \
  "$BASE/" 2>/dev/null)
if [ "$hs" = "101" ]; then
  echo "ok   WebSocket handshake ($BASE -> 101)"
else
  echo "FAIL WebSocket handshake: HTTP $hs (atteso 101) — controlla Upgrade/Connection nel tuo reverse proxy"
  fail=1
fi

# redirect http->https se BASE e' https
if [ "${BASE#https://}" != "$BASE" ]; then
  redir=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://${BASE#https://}/" 2>/dev/null || true)
  [ "$redir" = "301" ] && echo "ok   redirect http->https (301)" || { echo "warn redirect http->https: HTTP $redir"; }
fi

if [ $fail -eq 0 ]; then echo; echo "TUTTO OK: $BASE pronto (web app + /admin + API + WebSocket)"; else echo; echo "ALCUNI CONTROLLI FALLITI"; exit 1; fi
