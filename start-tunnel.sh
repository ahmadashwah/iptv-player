#!/bin/bash
# Starts cloudflared tunnel and registers the URL with the Cloudflare Worker registry.
# Run this on the Raspberry Pi — it is managed by the iptv-tunnel.service systemd unit.

WORKER_URL="https://iptv-tunnel.ahmadashwah.workers.dev"
SECRET="5ef8aa4d1c5bc83af490e5732495d690"
REGISTERED=false

echo "[tunnel] Starting cloudflared..."

cloudflared tunnel --url http://localhost:8888 2>&1 | while IFS= read -r line; do
  echo "[cloudflared] $line"

  # Extract the tunnel URL from cloudflared output
  if [ "$REGISTERED" = false ] && echo "$line" | grep -qE 'https://[a-z0-9-]+\.trycloudflare\.com'; then
    TUNNEL_URL=$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com')
    echo "[tunnel] Got URL: $TUNNEL_URL"

    # Register with Cloudflare Worker (retry up to 5 times)
    for i in 1 2 3 4 5; do
      HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        "${WORKER_URL}/?secret=${SECRET}" \
        -H "Content-Type: text/plain" \
        --data "${TUNNEL_URL}" \
        --max-time 10)

      if [ "$HTTP_STATUS" = "200" ]; then
        echo "[tunnel] Registered URL with worker (attempt $i) ✓"
        REGISTERED=true
        break
      else
        echo "[tunnel] Registration attempt $i failed (HTTP $HTTP_STATUS), retrying..."
        sleep 3
      fi
    done
  fi
done
