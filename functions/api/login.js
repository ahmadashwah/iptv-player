export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const { email, password: loginPassword } = await request.json();

    if (!email || !loginPassword) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers });
    }

    // Load users from KV
    const usersJson = await env.APP_KV.get('users');
    if (!usersJson) {
      return new Response(JSON.stringify({ error: 'Service not configured' }), { status: 503, headers });
    }

    const users = JSON.parse(usersJson);
    const user = users[email.toLowerCase().trim()];

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers });
    }

    // Compare SHA-256 hashed password
    const hash = await sha256(loginPassword);
    if (hash !== user.passwordHash) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers });
    }

    // Per-user IPTV credentials take priority, fall back to global config
    let server = user.server || '';
    let username = user.username || '';
    let password = user.iptv_password || '';
    let tmdbKey  = user.tmdbKey  || '';

    if (!server) {
      const configJson = await env.APP_KV.get('iptv_config');
      if (!configJson) {
        return new Response(JSON.stringify({ error: 'IPTV service not configured' }), { status: 503, headers });
      }
      const config = JSON.parse(configJson);
      server   = config.server   || '';
      username = config.username || '';
      password = config.password || '';
      tmdbKey  = config.tmdbKey  || '';
    }

    return new Response(JSON.stringify({
      ok: true,
      name: user.name || email,
      server, username, password, tmdbKey,
    }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
