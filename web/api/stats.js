// GET /api/stats — the game-start "database view": totals plus the most recent
// rows, rendered as a plain HTML table straight from the Blob store. All data is
// anonymous (see /api/log), so the page is public.
const RACE = { 0: 'Zerg', 1: 'Terran', 2: 'Protoss' };

module.exports = async (req, res) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(503).send('no store');

  // List every event (paginated), newest pathnames first (they start with an ISO time).
  const blobs = [];
  let cursor = '';
  do {
    const r = await fetch(
      `https://blob.vercel-storage.com/?prefix=starts/&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { headers: { authorization: `Bearer ${token}`, 'x-api-version': '7' } },
    );
    if (!r.ok) return res.status(502).send('store list failed');
    const page = await r.json();
    blobs.push(...(page.blobs || []));
    cursor = page.hasMore ? page.cursor : '';
  } while (cursor && blobs.length < 20000);
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));

  // Fetch the most recent rows for the table; older ones only count toward totals.
  const recent = await Promise.all(
    blobs.slice(0, 200).map((b) => fetch(b.url).then((r) => (r.ok ? r.json() : null)).catch(() => null)),
  );
  const rows = recent.filter(Boolean);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const count = (key, fmt = (x) => x) => {
    const m = {};
    for (const r of rows) { const k = fmt(r[key]) ?? '—'; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${esc(k)} ${n}`).join(' · ');
  };
  const mapName = (m) => String(m ?? '').split('/').pop().replace(/\.(scx|scm)$/i, '').replace(/%20/g, ' ');

  const table = rows.map((r) => `<tr>
    <td>${esc(r.at?.replace('T', ' ').slice(0, 19))}</td><td>${esc(mapName(r.map))}</td>
    <td>${esc(r.mode)}</td><td>${esc(RACE[r.my_race] ?? r.my_race ?? '—')}</td>
    <td>${esc(r.opponent)}</td><td>${esc(r.difficulty ?? '—')}</td>
    <td>${r.mobile ? 'yes' : 'no'}</td></tr>`).join('');

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=60');
  return res.status(200).send(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenBW game starts</title>
<style>
  body { background:#0b1220; color:#e2e8f0; font: 14px system-ui, sans-serif; margin: 24px auto; max-width: 900px; padding: 0 16px; }
  h1 { font-size: 20px; } .sub { color:#94a3b8; margin: 4px 0 18px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #1e293b; white-space: nowrap; }
  th { color:#94a3b8; font-weight: 600; }
  .agg { color:#cbd5e1; margin: 4px 0; } .agg b { color:#38bdf8; }
  .wrap { overflow-x: auto; }
</style>
<h1>OpenBW — game starts</h1>
<p class="sub">${blobs.length} games total · latest ${rows.length} shown · UTC</p>
<p class="agg"><b>Mode</b> ${count('mode')}</p>
<p class="agg"><b>Race</b> ${count('my_race', (v) => RACE[v] ?? v)}</p>
<p class="agg"><b>Opponent</b> ${count('opponent')}</p>
<p class="agg"><b>Difficulty</b> ${count('difficulty')}</p>
<div class="wrap"><table>
<tr><th>When</th><th>Map</th><th>Mode</th><th>Race</th><th>Opponent</th><th>Difficulty</th><th>Mobile</th></tr>
${table}
</table></div>`);
};
