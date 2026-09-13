// /api/img?url=... — 画像をCORS付きで中継（写真の自動登録用）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) {
    res.status(400).end('bad url');
    return;
  }
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Referer': new URL(url).origin + '/',
      },
    });
    if (!r.ok) {
      res.status(502).end('fetch failed');
      return;
    }
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image')) {
      res.status(415).end('not image');
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 's-maxage=604800');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).end('error');
  }
}
