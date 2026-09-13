// /api/scrape?url=... — レシピページをサーバー側で取得して解析（CORS・無料プロキシ非依存）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) {
    res.status(400).json({ error: 'bad url' });
    return;
  }
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    const html = await r.text();

    const out = { title: '', image: '', yield: '', ingredients: [], steps: [] };

    // og:title / og:image
    const og = (p) => {
      const m =
        html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${p}["']`, 'i'));
      return m ? m[1] : '';
    };
    out.title = og('og:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    out.image = og('og:image');

    // JSON-LD (schema.org/Recipe)
    const ldBlocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const b of ldBlocks) {
      let j;
      try { j = JSON.parse(b[1]); } catch { continue; }
      const nodes = [].concat(j['@graph'] || j).flat();
      const rec = nodes.find((n) => n && /Recipe/.test(String(n['@type'])));
      if (!rec) continue;
      if (rec.name && !out.title) out.title = rec.name;
      if (rec.image) {
        const im = [].concat(rec.image)[0];
        out.image = (im && im.url) || (typeof im === 'string' ? im : out.image);
      }
      if (rec.recipeYield) out.yield = String([].concat(rec.recipeYield)[0]);
      if (Array.isArray(rec.recipeIngredient)) out.ingredients = rec.recipeIngredient.map(String);
      const inst = rec.recipeInstructions;
      if (inst) {
        out.steps = []
          .concat(inst)
          .flatMap((x) => {
            if (typeof x === 'string') return [x];
            if (x && x.text) return [x.text];
            if (x && Array.isArray(x.itemListElement))
              return x.itemListElement.map((y) => y.text || '').filter(Boolean);
            return [];
          })
          .map((t) => t.trim())
          .filter(Boolean);
      }
      break;
    }

    // __NEXT_DATA__（新クックパッド等のNext.jsサイト向けフォールバック）
    if (out.ingredients.length < 2 || out.steps.length < 2) {
      const nd = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (nd) {
        try {
          const data = JSON.parse(nd[1]);
          const found = { ing: null, steps: null, serving: '' };
          (function walk(o, depth) {
            if (!o || typeof o !== 'object' || depth > 12) return;
            if (Array.isArray(o.ingredients) && o.ingredients.length >= 2 && !found.ing) {
              const ls = o.ingredients
                .map((i) => {
                  if (typeof i === 'string') return i;
                  const n = i.name || i.title || '';
                  const q = i.quantity || i.amount || i.quantityAndUnit || '';
                  return (n + ' ' + q).trim();
                })
                .filter(Boolean);
              if (ls.length >= 2) found.ing = ls;
            }
            if (Array.isArray(o.steps) && o.steps.length >= 2 && !found.steps) {
              const ls = o.steps
                .map((st) => {
                  if (typeof st === 'string') return st;
                  return st.description || st.text || st.memo || '';
                })
                .map((t) => String(t).trim())
                .filter(Boolean);
              if (ls.length >= 2) found.steps = ls;
            }
            if (o.serving && !found.serving) found.serving = String(o.serving);
            for (const k in o) walk(o[k], depth + 1);
          })(data, 0);
          if (found.ing && out.ingredients.length < 2) out.ingredients = found.ing;
          if (found.steps && out.steps.length < 2) out.steps = found.steps;
          if (found.serving && !out.yield) out.yield = found.serving;
        } catch {}
      }
    }

    // itemprop フォールバック
    if (out.ingredients.length < 2) {
      const ms = [...html.matchAll(/itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)</gi)];
      const ls = ms.map((m) => m[1].replace(/\s+/g, ' ').trim()).filter((t) => t && t.length <= 60);
      if (ls.length >= 2) out.ingredients = ls;
    }

    res.setHeader('Cache-Control', 's-maxage=86400');
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: 'fetch failed' });
  }
}
