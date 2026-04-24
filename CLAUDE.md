# CLAUDE.md

## Overview

Multi-platform IPTV player (Xtream Codes compatible). Monolithic HTML frontend + distributed backend (Raspberry Pi proxy + Cloudflare Workers/Pages/Functions). Solves datacenter IP blocking by routing streams through a residential IP via Pi + Cloudflare Tunnel.

## Architecture

```
Browser (index.html) ──► Pi Proxy (iptv-proxy.js:8888) ──► IPTV Server
                    └──► Cloudflare Functions (/api/*) ──► TMDB / OpenSubtitles
Android (WebView)  ──► same web player URL
```

**Components:**
- `index.html` — Single-file web app (~4300 lines: HTML+CSS+JS). All UI, state, and playback logic
- `iptv-proxy.js` — Express server on Pi. Proxies requests, rewrites M3U8 URLs, handles Range/redirects
- `worker.js` — Cloudflare Worker CORS proxy (alternative to Pi)
- `tunnel-worker/worker.js` — KV-backed tunnel URL registry (GET=read, POST=update)
- `functions/api/` — Cloudflare Pages Functions: `login.js` (auth via KV), `img.js` (image proxy), `subtitles.js` (OpenSubtitles bridge)
- `android/` — Kotlin/Leanback WebView wrapper targeting SDK 21-34

## Key Internals

**Global state object `S`** holds all app state: config, mode (live/vod/series), loaded data, HLS instance, playback state. Persisted to localStorage (`iptv_cfg`, `iptv_continue`, `iptv_saved`). Password in sessionStorage only.

**Video pipeline:** HLS.js with custom manifest loader that rewrites segment URLs through proxy. Falls back to direct HTML5 `<video>` for non-HLS. Subtitle support via SRT→VTT conversion.

**API calls:** `xtream(action, params)` hits `/player_api.php` on the IPTV server (through proxy). TMDB enrichment via `fetchTMDB()` for metadata/cast/backdrops.

**UI screens:** Home (continue watching + saved + trending) → Panel/Browse (categories + items) → Detail (metadata + episodes) → Player (fullscreen video). Navigation via CSS classes on `<body>`.

## Deployment

No CI/CD pipeline. Manual deploy commands:
```bash
# Web player → Cloudflare Pages
cp index.html dist/ && npx wrangler pages deploy dist --project-name iptv-player --branch main

# Tunnel worker → Cloudflare Workers
cd tunnel-worker && npx wrangler deploy

# Pi proxy → Raspberry Pi
scp iptv-proxy.js user@pi:~/iptv/ && ssh pi 'sudo systemctl restart iptv-proxy'
```

Pi runs two systemd services: `iptv-proxy` (Express) and `iptv-tunnel` (cloudflared). Both auto-restart.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML/CSS/JS, HLS.js (CDN) |
| Backend | Node.js + Express 4.18 |
| Android | Kotlin, AndroidX Leanback, WebView |
| Hosting | Cloudflare Pages (free) |
| Edge | Cloudflare Workers + KV |
| Tunnel | cloudflared (trycloudflare.com) |
| APIs | Xtream Codes, TMDB, OpenSubtitles |

## File Map

```
index.html                  # Web app (all-in-one)
iptv-proxy.js               # Pi proxy server
worker.js                   # CF Worker CORS proxy
start-tunnel.sh             # Pi tunnel boot script
package.json                # Node deps (express only)
tunnel-worker/
  worker.js                 # Tunnel URL registry
  wrangler.toml             # CF Worker config (KV binding)
functions/api/
  login.js                  # Auth (SHA-256, CF KV users)
  img.js                    # Image proxy (7-day cache)
  subtitles.js              # OpenSubtitles search
  subtitles/download.js     # Subtitle file download
android/app/src/main/java/com/ashwah/tv/
  MainActivity.kt           # WebView + D-pad forwarding
dist/                       # CF Pages deploy target
DOCUMENTATION.md            # Full architecture docs (442 lines)
```

## Dev Notes

- `index.html` is the only frontend file. All changes go there
- Pi proxy listens on port 8888 (configurable via `PORT` env var)
- Tunnel URL is dynamic (trycloudflare.com). `start-tunnel.sh` registers it with the worker on boot
- Android app loads remote URL — update the web app, Android updates automatically
- No build step, no bundler, no framework — edit and deploy
