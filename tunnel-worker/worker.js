// Tunnel URL registry worker
// GET  /        → returns current Pi tunnel URL
// POST /?secret=SECRET → stores new tunnel URL (called by Pi on startup)
// OPTIONS /     → CORS preflight

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // GET / → return current tunnel URL
    if (request.method === 'GET') {
      const tunnelUrl = await env.TUNNEL_KV.get('url');
      if (!tunnelUrl) {
        return new Response(JSON.stringify({ error: 'No tunnel URL registered yet' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ url: tunnelUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /?secret=SECRET → register new tunnel URL
    if (request.method === 'POST') {
      const secret = url.searchParams.get('secret');
      if (!secret || secret !== env.SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      const body = await request.text();
      const tunnelUrl = body.trim();
      if (!tunnelUrl.startsWith('https://')) {
        return new Response('Invalid URL', { status: 400, headers: corsHeaders });
      }
      await env.TUNNEL_KV.put('url', tunnelUrl);
      return new Response('OK', { headers: corsHeaders });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
