const OPENSUB_KEY = 'Vlzuj8IeWpRVeF0XyJ5NRO6QGicLpUBF';
const BASE = 'https://api.opensubtitles.com/api/v1';
const HEADERS = {
  'Api-Key': OPENSUB_KEY,
  'Content-Type': 'application/json',
  'User-Agent': 'AshwahTV/1.0',
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const res = await fetch(`${BASE}/download`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ file_id: body.file_id }),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: CORS });
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
