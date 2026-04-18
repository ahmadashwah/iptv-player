export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const imgUrl = url.searchParams.get('url');

  if (!imgUrl) return new Response('missing url', { status: 400 });

  try {
    const res = await fetch(imgUrl, {
      headers: { 'Referer': imgUrl, 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return new Response('upstream error', { status: res.status });

    const ct = res.headers.get('Content-Type') || 'image/jpeg';
    return new Response(res.body, {
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=604800', // 7 days
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (e) {
    return new Response('fetch error', { status: 502 });
  }
}
