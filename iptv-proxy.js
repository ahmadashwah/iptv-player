'use strict';

const express = require('express');
const http    = require('http');
const https   = require('https');
const { URL } = require('url');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8888;

// ── CORS + mixed-content headers ─────────────────────────────────────────────
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});
app.options('*', (_, res) => res.sendStatus(204));

// ── Serve the player ──────────────────────────────────────────────────────────
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Generic proxy ─────────────────────────────────────────────────────────────
// GET /proxy?url=<encoded-target-url>
app.get('/proxy', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing ?url= parameter' });

  let target;
  try { target = new URL(rawUrl); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  fetchRemote(target.toString(), res, 0);
});

// ── Core fetch + redirect follower ────────────────────────────────────────────
function fetchRemote(url, res, hops) {
  if (hops > 5) return res.status(502).json({ error: 'Too many redirects' });

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'Bad redirect URL' }); }

  const mod = parsed.protocol === 'https:' ? https : http;

  const opts = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (IPTV-Proxy/1.0)',
      'Accept':     '*/*',
    },
    timeout: 20_000,
  };

  const req = mod.request(opts, upRes => {
    // Follow redirects
    if ([301, 302, 303, 307, 308].includes(upRes.statusCode)) {
      const loc = upRes.headers.location;
      if (loc) {
        const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
        upRes.resume(); // drain body
        return fetchRemote(next, res, hops + 1);
      }
    }

    const ct      = (upRes.headers['content-type'] || '').toLowerCase();
    const isM3U8  = ct.includes('mpegurl') || /\.m3u8?(\?|$)/i.test(parsed.pathname);

    if (isM3U8) {
      // Read full manifest, rewrite internal URLs, forward
      let body = '';
      upRes.setEncoding('utf8');
      upRes.on('data', d => body += d);
      upRes.on('end', () => {
        if (res.headersSent) return;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(rewriteM3U8(body, url));
      });
    } else {
      // Pass through binary (TS segments, JSON, images, …)
      if (res.headersSent) return;
      const passHeaders = {};
      for (const h of ['content-type', 'content-length', 'cache-control']) {
        if (upRes.headers[h]) passHeaders[h] = upRes.headers[h];
      }
      res.writeHead(upRes.statusCode, passHeaders);
      upRes.pipe(res);
    }
  });

  req.on('timeout', () => {
    req.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'Gateway timeout' });
  });
  req.on('error', err => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  });
  req.end();
}

// ── M3U8 URL rewriter ─────────────────────────────────────────────────────────
// Rewrites every non-comment line and EXT-X-KEY URI to go through /proxy
function rewriteM3U8(content, baseUrl) {
  const base = new URL(baseUrl);

  function toProxy(uri) {
    try {
      const abs = uri.startsWith('http://') || uri.startsWith('https://')
        ? uri
        : new URL(uri, base).toString();
      return `/proxy?url=${encodeURIComponent(abs)}`;
    } catch { return uri; }
  }

  return content.split('\n').map(line => {
    const t = line.trim();

    // Rewrite DRM key URIs inside EXT-X-KEY tags
    if (t.startsWith('#EXT-X-KEY') && t.includes('URI=')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${toProxy(uri)}"`);
    }

    // Skip other comment/tag lines and blank lines
    if (!t || t.startsWith('#')) return line;

    // Segment / sub-playlist URL
    return toProxy(t);
  }).join('\n');
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   IPTV Player  →  http://localhost:${PORT}  ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
