#!/bin/bash
# Run TLS-MITM socat proxy for Cync phone app.
# Phone (with DNS hijacked to this Mac) connects to port 23779;
# we terminate TLS with our self-signed cert, then re-open TLS to
# the real Cync cloud and relay bytes. Both directions are logged
# as timestamped hex to captures/dump.txt.
#
# Run this in its own terminal. Ctrl-C to stop.

set -euo pipefail
cd "$(dirname "$0")"

CERT="server.pem"
UPSTREAM_IP="35.196.85.236"   # cm.gelighting.com — see upstream.txt
UPSTREAM_PORT="23779"
LISTEN_PORT="23779"
OUT="../../captures/dump.txt"

mkdir -p "$(dirname "$OUT")"
echo "=== Cync MITM capture starting $(date) ===" | tee -a "$OUT"
echo "Listening on 0.0.0.0:$LISTEN_PORT, forwarding to $UPSTREAM_IP:$UPSTREAM_PORT" | tee -a "$OUT"
echo "Log: $OUT"
echo

# -x -v dumps both directions in hex with '>' (client→server) / '<' (server→client) arrows.
# -d -d puts socat in verbose mode so we get timestamps + connection events.
# fork spawns a child per incoming connection (phone may open several).
exec socat -d -d -lf /dev/stdout -x -v 2>&1 \
  "openssl-listen:$LISTEN_PORT,reuseaddr,fork,cert=$CERT,verify=0" \
  "openssl:$UPSTREAM_IP:$UPSTREAM_PORT,verify=0" \
  | tee -a "$OUT"
