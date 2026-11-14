#!/usr/bin/env bash
# Written with AI assistance (Claude / GitHub Copilot)
# One-command integration check. Usage: bash scripts/check_all.sh [--no-pull]
# No `set -e` on purpose: every step runs, then one table, exit 1 on any FAIL.
cd "$(dirname "$0")/.." || exit 2
TMP=$(mktemp -d); NAMES=(); RES=(); ERRS=()
SRV=""; trap '[ -n "$SRV" ] && kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT

# add NAME RESULT LOGFILE|"" : first line matching error|fail|problem|Traceback becomes the error column
add() {
  local e="-"
  if [ -n "$3" ] && [ -f "$3" ]; then
    e=$(grep -i -m1 -E 'error|fail|problem|Traceback' "$3" | cut -c1-80)
    [ -z "$e" ] && e="-"
  elif [ -n "$3" ]; then e="$3"; fi
  [ "$2" = PASS ] && e="-"
  NAMES+=("$1"); RES+=("$2"); ERRS+=("$e")
}
run() { # run NAME cmd...  -> PASS/FAIL by exit code
  local n=$1; shift; "$@" >"$TMP/$n.log" 2>&1
  if [ $? -eq 0 ]; then add "$n" PASS ""; else add "$n" FAIL "$TMP/$n.log"; fi
}

# 1. pull
if [ "$1" = "--no-pull" ]; then add git-pull SKIP "--no-pull passed"
elif [ -n "$(git status --porcelain)" ]; then add git-pull SKIP "tree is dirty"
else run git-pull git pull --ff-only; fi

# 2. data check
PY=python3
for p in python3.13 python3; do
  if command -v $p >/dev/null && $p -c 'import numpy, PIL' 2>/dev/null; then PY=$p; break; fi
done
run check_data "$PY" scripts/check_data.py

# 3. node demo test
if [ -f scripts/test_demo.mjs ]; then run test_demo node scripts/test_demo.mjs
else add test_demo FAIL "missing scripts/test_demo.mjs"; fi

# 4. browser test pages
PAGES=$(find . -name '*.test.html' -not -path './.git/*' | sed 's|^\./||' | sort)
CH=""
for c in "$CHROME" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" chromium chromium-browser; do
  [ -n "$c" ] && { [ -x "$c" ] || command -v "$c" >/dev/null; } && { CH=$c; break; }
done
PORT=""
if [ -n "$CH" ]; then
  for p in 8791 8792; do
    python3 -m http.server $p >"$TMP/srv.log" 2>&1 & SRV=$!; disown
    sleep 1
    if kill -0 $SRV 2>/dev/null; then PORT=$p; break; fi
    SRV=""
  done
fi
for pg in $PAGES; do
  if [ -z "$PORT" ]; then add "$pg" MANUAL "open http://localhost:8791/$pg (python3 -m http.server 8791)"; continue; fi
  "$CH" --headless=new --disable-gpu --virtual-time-budget=10000 --dump-dom "http://localhost:$PORT/$pg" >"$TMP/dom.html" 2>"$TMP/chrome.err"
  # Both pages render <li class="pass|fail">PASS|FAIL name</li> and a #summary "N/M passed".
  # PASS = summary has equal N/M AND no class="fail" row; anything else (incl. "running...") = FAIL.
  sum=$(grep -o -E '[0-9]+/[0-9]+ passed' "$TMP/dom.html" | head -1)
  { echo "summary: ${sum:-none}"; grep -o -E '<li class="fail">[^<]*' "$TMP/dom.html" | sed 's/<li class="fail">//'; } >"$TMP/p.log"
  if [ -n "$sum" ] && [ "${sum%%/*}" = "$(echo "$sum" | sed 's|.*/\([0-9]*\) .*|\1|')" ] && ! grep -q 'class="fail"' "$TMP/dom.html"; then
    add "$pg" PASS "$sum"
  else
    [ -z "$sum" ] && echo "FAIL no summary rendered" >>"$TMP/p.log"
    add "$pg" FAIL "$TMP/p.log"
  fi
done

printf '\n%-28s | %-6s | %s\n' check result "first error line"
printf '%s\n' "-----------------------------+--------+------------------------------"
bad=0
for i in "${!NAMES[@]}"; do
  printf '%-28s | %-6s | %s\n' "${NAMES[$i]}" "${RES[$i]}" "${ERRS[$i]}"
  [ "${RES[$i]}" = FAIL ] && bad=1
done
exit $bad
