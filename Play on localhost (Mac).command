#!/bin/bash
# Double-click to play Circle Chase at http://localhost:8090 (only this computer can open it).
# It serves whatever branch is checked out in GitHub Desktop: switch branch, then refresh the page.
cd "$(dirname "$0")" || exit 1
PORT=8090
URL="http://localhost:$PORT/"

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Already running at $URL"
  open "$URL"
  exit 0
fi

echo "Circle Chase at $URL  (branch: $(git branch --show-current 2>/dev/null || echo unknown))"
echo "Leave this window open while you play. Close it or press Ctrl+C to stop."
(sleep 1; open "$URL") &

# A plain file server that tells the browser never to cache, so a refresh always shows the
# branch you just switched to. Bound to 127.0.0.1 so nobody else on the network can reach it.
exec python3 -I - "$PORT" <<'PY'
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), NoCache).serve_forever()
PY
