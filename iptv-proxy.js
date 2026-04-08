'use strict';

const express = require('express');
const http    = require('http');
const https   = require('https');
const zlib    = require('zlib');
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
app.get('/proxy', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing ?url= parameter' });

  let target;
  try { target = new URL(rawUrl); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  // Forward Range header so video seeking works
  const range = req.headers['range'];
  fetchRemote(target.toString(), res, 0, range);
});

// ── Core fetch + redirect follower ────────────────────────────────────────────
function fetchRemote(url, res, hops, range) {
  if (hops > 5) return res.status(502).json({ error: 'Too many redirects' });

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'Bad redirect URL' }); }

  const mod = parsed.protocol === 'https:' ? https : http;

  const reqHeaders = {
    'User-Agent':      'Mozilla/5.0 (IPTV-Proxy/1.0)',
    'Accept':          '*/*',
    'Accept-Encoding': 'gzip, deflate, identity', // request compression so we can decompress properly
  };
  if (range) reqHeaders['Range'] = range;

  const opts = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   'GET',
    headers:  reqHeaders,
    timeout:  30_000,
  };

  const req = mod.request(opts, upRes => {
    // Follow redirects (preserve range header)
    if ([301, 302, 303, 307, 308].includes(upRes.statusCode)) {
      const loc = upRes.headers.location;
      if (loc) {
        const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
        upRes.resume();
        return fetchRemote(next, res, hops + 1, range);
      }
    }

    const ct     = (upRes.headers['content-type'] || '').toLowerCase();
    const isM3U8 = ct.includes('mpegurl') || /\.m3u8?(\?|$)/i.test(parsed.pathname);

    if (isM3U8) {
      // Decompress if needed, then read as UTF-8 text
      const encoding = (upRes.headers['content-encoding'] || '').toLowerCase();
      let stream = upRes;
      if (encoding === 'gzip')    stream = upRes.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = upRes.pipe(zlib.createInflate());
      else if (encoding === 'br') stream = upRes.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      stream.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      stream.on('end', () => {
        if (res.headersSent) return;
        const body = Buffer.concat(chunks).toString('utf8');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(rewriteM3U8(body, url));
      });
      stream.on('error', err => {
        if (!res.headersSent) res.status(502).json({ error: 'Decompress error: ' + err.message });
      });
    } else {
      if (res.headersSent) return;
      // Forward relevant headers including range-related ones
      const passHeaders = {};
      for (const h of [
        'content-type', 'content-length', 'content-encoding', 'content-range',
        'accept-ranges', 'cache-control', 'last-modified', 'etag',
      ]) {
        if (upRes.headers[h]) passHeaders[h] = upRes.headers[h];
      }
      // Always advertise correct range support so the browser can seek
      passHeaders['accept-ranges'] = 'bytes';
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
    if (t.startsWith('#EXT-X-KEY') && t.includes('URI=')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${toProxy(uri)}"`);
    }
    if (!t || t.startsWith('#')) return line;
    return toProxy(t);
  }).join('\n');
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   IPTV Player  →  http://localhost:${PORT}  ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
