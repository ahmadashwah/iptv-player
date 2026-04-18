# IPTV Player — Project Documentation

## Overview

A self-hosted IPTV player that streams content from an Xtream-compatible IPTV provider
(`cf.turbostech.com`). The app is hosted for free on Cloudflare Pages and routes all
media requests through a Raspberry Pi at home to bypass the provider's datacenter IP block.

---

## The Problem This Solves

The IPTV provider blocks requests from datacenter IPs (cloud servers, VPNs, etc.).
Any request coming from Railway, AWS, Cloudflare Workers, etc. gets rejected with an
error. Only residential IPs (home internet connections) are allowed.

The solution: the player is hosted in the cloud (static HTML, no restrictions), but
every request to the IPTV provider is routed through a Raspberry Pi sitting on a home
network with a residential IP.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Your Browser                         │
└────────────────────────────┬────────────────────────────────┘
                             │ opens
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Pages (free, permanent)             │
│           iptv-player-d3o.pages.dev                         │
│                                                             │
│   Serves index.html — the entire app (HTML + CSS + JS)      │
└────────────────────────────┬────────────────────────────────┘
                             │ on load, fetches current Pi URL from
                             ▼
┌─────────────────────────────────────────────────────────────┐
│         Cloudflare Worker + KV  (free, permanent)           │
│         iptv-tunnel.ahmadashwah.workers.dev                 │
│                                                             │
│   Stores the Pi's current tunnel URL in a KV key.           │
│   Pi posts here on every boot. Player reads on every load.  │
└────────────────────────────┬────────────────────────────────┘
                             │ returns current tunnel URL
                             ▼
┌─────────────────────────────────────────────────────────────┐
│   All IPTV requests (channels, live TV, movies, series)     │
│   are sent to the Pi tunnel URL, e.g.:                      │
│   https://some-words.trycloudflare.com/proxy?url=...        │
└────────────────────────────┬────────────────────────────────┘
                             │ tunnelled through Cloudflare → Pi
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Raspberry Pi  (home network)                   │
│                                                             │
│   iptv-proxy.js    Node.js server on port 8888              │
│   cloudflared      Cloudflare Tunnel exposing port 8888     │
└────────────────────────────┬────────────────────────────────┘
                             │ fetches using residential IP
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              cf.turbostech.com  (IPTV provider)             │
│   Serves channel lists, live streams, movies, series        │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure

### On Your Mac (source of truth)
```
/Users/ahmadashwah/Documents/code/iptv/
│
├── index.html              Main app — the entire player in one file
│                           HTML structure + CSS styles + JavaScript logic
│
├── iptv-proxy.js           Node.js/Express proxy server
│                           Runs on the Raspberry Pi, port 8888
│                           Forwards any HTTP request through the Pi's
│                           residential IP, adding CORS headers
│
├── package.json            Node.js dependencies (express, node-fetch, etc.)
│
├── start-tunnel.sh         Pi startup script
│                           Starts cloudflared, waits for tunnel URL,
│                           posts it to the Cloudflare Worker registry
│
├── dist/
│   └── index.html          Copy of index.html deployed to Cloudflare Pages
│                           Rebuilt with: cp index.html dist/index.html
│
└── tunnel-worker/
    ├── worker.js           Cloudflare Worker source code
    │                       GET /  → returns current tunnel URL from KV
    │                       POST /?secret=  → stores new tunnel URL in KV
    └── wrangler.toml       Worker deployment config
                            Contains KV namespace ID
```

### On GitHub
```
github.com/ahmadashwah/iptv-player
Same files as above, version controlled
```

### On the Raspberry Pi
```
/home/ashwah1993/iptv/
├── iptv-proxy.js           The running proxy server
├── start-tunnel.sh         The tunnel startup script
└── node_modules/           Node.js dependencies (installed via npm install)
```

---

## Services Running on the Pi

Both are **systemd services** — they start automatically on every boot
and restart automatically if they crash.

### iptv-proxy.service
```
/etc/systemd/system/iptv-proxy.service
```
- Runs `node iptv-proxy.js`
- Listens on port 8888
- Exposes a `/proxy?url=TARGET_URL` endpoint
- Fetches TARGET_URL server-side and returns the response with CORS headers
- Also handles range requests (for video seeking in movies/series)

### iptv-tunnel.service
```
/etc/systemd/system/iptv-tunnel.service
```
- Runs `start-tunnel.sh`
- Script starts `cloudflared tunnel --url http://localhost:8888`
- cloudflared connects to Cloudflare's network and gets a random HTTPS URL
  (e.g. `https://some-words-here.trycloudflare.com`)
- Script extracts that URL and POSTs it to the Cloudflare Worker registry
- The tunnel stays open, forwarding all HTTPS traffic to localhost:8888

---

## Boot Sequence (What Happens When Pi Turns On)

```
1. systemd starts iptv-proxy.service
   → Node.js server listening on port 8888

2. systemd starts iptv-tunnel.service
   → cloudflared dials Cloudflare's network
   → receives a new random tunnel URL
   → start-tunnel.sh extracts the URL

3. start-tunnel.sh POSTs to Worker registry:
   POST https://iptv-tunnel.ahmadashwah.workers.dev/?secret=...
   Body: https://new-random-url.trycloudflare.com

4. Worker stores new URL in KV store
   Key: "url"
   Value: "https://new-random-url.trycloudflare.com"
```

---

## Player Load Sequence (What Happens When You Open the App)

```
1. Browser opens https://iptv-player-d3o.pages.dev
   → Cloudflare Pages serves index.html

2. JavaScript runs immediately:
   refreshTunnelUrl()
   → GET https://iptv-tunnel.ahmadashwah.workers.dev/
   → receives { url: "https://current-pi-url.trycloudflare.com" }
   → stores in S.cfg.liveProxy (memory + localStorage)

3. If logged in (credentials in localStorage + session password cached):
   loadCurrent() is called automatically
   → fetches channel list via px() which uses liveProxy
   → request goes to Pi tunnel → Pi fetches from IPTV server

4. User clicks a channel:
   Live TV  → https://[pi-tunnel]/proxy?url=http://cf.turbostech.com/live/...
   Movie    → https://[pi-tunnel]/proxy?url=http://cf.turbostech.com/movie/...
   Series   → https://[pi-tunnel]/proxy?url=http://cf.turbostech.com/series/...
```

---

## Key Functions in index.html

| Function | Purpose |
|---|---|
| `refreshTunnelUrl()` | Fetches current Pi URL from Worker KV, updates `S.cfg.liveProxy` |
| `px(url)` | Wraps a URL in the Pi proxy: `[tunnel]/proxy?url=[url]` |
| `playLive(ch)` | Plays a live TV channel via the tunnel |
| `playVOD(m)` | Plays a movie via the tunnel |
| `playEpisode(ep)` | Plays a series episode via the tunnel |
| `hlsPlay(url)` | Initialises hls.js for HLS stream playback |
| `xtream(action)` | Makes Xtream API calls (channel list, login, EPG) via `px()` |
| `loadCfg()` | Reads server/username/liveProxy from localStorage |
| `saveCfg()` | Writes server/username/liveProxy to localStorage |

---

## How the Proxy Works (iptv-proxy.js)

```
Browser                Pi (iptv-proxy.js)           IPTV Server
   │                          │                          │
   │  GET /proxy?url=TARGET   │                          │
   │ ─────────────────────── ▶│                          │
   │                          │  GET TARGET              │
   │                          │ ───────────────────────▶ │
   │                          │                          │
   │                          │  200 OK + video data     │
   │                          │ ◀─────────────────────── │
   │  200 OK + video data     │                          │
   │ ◀─────────────────────── │                          │
```

The proxy:
- Strips hop-by-hop headers before forwarding
- Adds `Access-Control-Allow-Origin: *` so browser doesn't block the response
- Forwards `Range` headers for video seeking support
- Follows redirects
- Passes through `Content-Type`, `Content-Length`, `Content-Encoding` etc.

---

## How Live TV Specifically Works

Live TV uses HLS (HTTP Live Streaming). A `.m3u8` playlist file lists short video
segments (~10 seconds each). The player must:
1. Fetch the playlist → get segment URLs
2. Fetch each segment in order → play them back-to-back

**The IP-binding problem:** The IPTV server ties session tokens to the IP address
that fetched the playlist. Both the playlist AND the segments must come from the
same IP. This is why everything must go through the Pi — if the playlist comes
from the Pi but segments try to load directly, they get rejected.

**The solution:** Pass the tunnel URL directly to hls.js as the source URL.
The Pi proxy rewrites segment paths in the playlist to root-relative paths
(`/proxy?url=...`). hls.js resolves these against the tunnel base URL, producing
absolute tunnel URLs for each segment. Both playlist and segments go through the Pi. ✓

---

## Cloudflare Worker Registry

**URL:** `https://iptv-tunnel.ahmadashwah.workers.dev`

**Endpoints:**
```
GET  /           Returns: { "url": "https://current-tunnel.trycloudflare.com" }
POST /?secret=X  Body: new tunnel URL — stores it in KV
```

**Secret:** Stored as a Cloudflare Worker secret (not in code).
The Pi's `start-tunnel.sh` knows the secret and uses it when registering.

**KV Namespace:** `TUNNEL_KV` (ID: `759645dc30fb4f5f90b1fa094aa380e2`)

---

## Deployment

### Deploying a change to the player (index.html)
```bash
cd /Users/ahmadashwah/Documents/code/iptv
# edit index.html
cp index.html dist/index.html
npx wrangler pages deploy dist --project-name iptv-player --branch main
git add index.html dist/index.html && git commit -m "..." && git push
```

### Deploying a change to the Worker
```bash
cd /Users/ahmadashwah/Documents/code/iptv/tunnel-worker
npx wrangler deploy
```

### Updating iptv-proxy.js on the Pi
```bash
scp iptv-proxy.js ashwah1993@AshwahRPI.local:~/iptv/iptv-proxy.js
ssh ashwah1993@AshwahRPI.local "sudo systemctl restart iptv-proxy"
```

---

## Useful Commands on the Pi

```bash
# Check service status
sudo systemctl status iptv-proxy
sudo systemctl status iptv-tunnel

# View live logs
sudo journalctl -u iptv-proxy -f
sudo journalctl -u iptv-tunnel -f

# Restart services
sudo systemctl restart iptv-proxy
sudo systemctl restart iptv-tunnel

# Check current registered tunnel URL
curl https://iptv-tunnel.ahmadashwah.workers.dev/
```

---

## Costs

| Service | Cost |
|---|---|
| Cloudflare Pages (player hosting) | Free forever |
| Cloudflare Worker + KV (URL registry) | Free forever |
| Cloudflare Tunnel (cloudflared) | Free forever |
| Raspberry Pi | One-time hardware cost (already owned) |
| Railway | ❌ No longer needed — cancel subscription |

---

## Troubleshooting

**Player shows "Pi not connected" in Settings**
→ Pi is off or tunnel hasn't started yet. Check Pi is on and run:
`sudo systemctl status iptv-tunnel`

**Live TV says "Connecting…" forever**
→ Tunnel is running but Pi proxy may be down. Check:
`sudo systemctl status iptv-proxy`

**Movies say "format not supported"**
→ Same as above — Pi proxy is not reachable.

**Channel list won't load**
→ Either Pi is down or IPTV credentials are wrong. Check Settings.

**Tunnel URL not updating after Pi reboot**
→ Check `start-tunnel.sh` has execute permission: `chmod +x ~/iptv/start-tunnel.sh`
→ Check logs: `sudo journalctl -u iptv-tunnel -f`

---

## Limitations & What Could Break

### 🔴 Single Points of Failure

**1. Raspberry Pi goes down**
Everything breaks — channels won't load, nothing plays. The entire backend runs on one
device at home. If the Pi crashes, loses power, or overheats, the player is dead until
you fix it.

**2. Home internet goes down**
Same result. No connection at home = no proxy = nothing works.

**3. Pi's SD card corrupts**
Raspberry Pis are notorious for SD card corruption, especially after sudden power cuts.
If this happens you'd need to reinstall everything from scratch. The code is safe on
GitHub but the systemd services, Node.js install, and cloudflared would need to be redone.

---

### 🟡 Things That Could Degrade

**4. Cloudflare Tunnel URL changes unexpectedly**
`trycloudflare.com` is a free "Quick Tunnel" — Cloudflare doesn't guarantee it stays up
or that the registration always succeeds. If cloudflared crashes and restarts rapidly,
the Worker KV might not update in time, causing the player to use a stale URL.

**5. Home upload bandwidth**
All video traffic passes through your Pi's home upload speed. If you're watching 1080p
(~4 Mbps) and someone else at home is uploading large files, streaming will buffer.
4K content (~20 Mbps) may be too much for most home connections.

**6. Cloudflare free tier limits**
- Workers: 100,000 requests/day free. Each page load = ~2 requests to the Worker.
  You'd need 50,000 visits/day to hit the limit — very unlikely.
- KV: 100,000 reads/day free. Same — not a real concern for personal use.
- Pages: unlimited requests, no bandwidth cap.

**7. `trycloudflare.com` deprecation**
Cloudflare could retire the free Quick Tunnel service at any time with little notice.
It's meant for testing, not production. This would break everything until you set up
a named tunnel with a real domain.

---

### 🟠 IPTV Provider Side

**8. Your IPTV subscription expires**
Nothing to do with the code — but when credentials expire, nothing plays.

**9. Provider changes their IP-blocking strategy**
If `cf.turbostech.com` starts blocking based on something other than IP (e.g. user-agent,
request patterns, session fingerprinting), the Pi tunnel might stop working too.

**10. Provider changes their API**
The app uses the Xtream Codes API. If the provider switches to a different protocol,
the channel list and login would break.

**11. Stream URLs become encrypted or signed**
Some providers add time-limited tokens to stream URLs. This already exists partially
(segment tokens are IP-bound), but if they add short-expiry URL signing, the proxy
approach might not work.

---

### 🔵 Minor Annoyances

**12. No offline support**
Completely useless without internet — nothing is cached.

**13. No multiple users**
If two people try to watch different channels at the same time from the same account,
the IPTV provider may kick one of them off (most providers limit concurrent streams to 1–2).

**14. Seeking in long movies is slow**
The video has to buffer through the Pi proxy. Seeking to a point 2 hours into a movie
means the proxy has to stream all that data through your home connection.

**15. Player URL is ugly**
`iptv-player-d3o.pages.dev` — not a real domain. You could buy a domain (~$10/year)
and point it here, but it's purely cosmetic.

---

### How to Mitigate the Biggest Risks

| Risk | Mitigation |
|---|---|
| SD card corruption | Use a USB SSD instead of SD card (much more reliable) |
| Pi power loss corruption | Add a UPS (small uninterruptible power supply) |
| Tunnel service deprecation | Set up a named Cloudflare Tunnel with a real domain ($1–10/year) |
| Pi is the only backend | Nothing cheap fixes this — fundamental trade-off of this approach |
