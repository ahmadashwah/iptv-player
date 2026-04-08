// Cloudflare Worker — IPTV CORS proxy for live streams
// Deploy: npx wrangler deploy worker.js --name iptv-cors
// Free tier: 100,000 requests/day, no credit card needed.
//
// All requests (manifest + segments) go through Cloudflare edge IPs,
// so the IPTV server's IP-bound session token works correctly.

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    try {
      const resp = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (IPTV/1.0)' },
        redirect: 'follow',
      });

      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      const isM3U8 = ct.includes('mpegurl') || targetUrl.includes('.m3u8');

      if (isM3U8) {
        const text = await resp.text();
        if (!text) return new Response('', { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });

        // Rewrite all URLs in the manifest to go through this same Worker
        const base = new URL(targetUrl);
        const workerBase = url.origin + url.pathname.split('?')[0];
        const rewritten = text.split('\n').map(line => {
          const t = line.trim();
          if (t.startsWith('#EXT-X-KEY') && t.includes('URI=')) {
            return line.replace(/URI="([^"]+)"/g, (_, uri) => {
              try {
                const abs = uri.startsWith('http') ? uri : new URL(uri, base).toString();
                return `URI="${workerBase}?url=${encodeURIComponent(abs)}"`;
              } catch { return `URI="${uri}"`; }
            });
          }
          if (!t || t.startsWith('#')) return line;
          try {
            const abs = t.startsWith('http') ? t : new URL(t, base).toString();
            return `${workerBase}?url=${encodeURIComponent(abs)}`;
          } catch { return line; }
        }).join('\n');

        return new Response(rewritten, {
          status: resp.status,
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // For binary segments — stream through directly
      return new Response(resp.body, {
        status: resp.status,
        headers: {
          'Content-Type': resp.headers.get('content-type') || 'video/mp2t',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      return new Response('Proxy error: ' + err.message, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
