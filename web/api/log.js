// POST /api/log — one anonymous game-start event into Vercel Blob (free tier).
// Called fire-and-forget by the game page (see logGameStart in openbw.js). Each
// event is a tiny JSON blob under starts/; /api/stats renders them as a table.
// No identifying data is accepted or stored — only the whitelisted fields below.
const FIELDS = ['map', 'mode', 'my_race', 'opponent', 'difficulty', 'mobile'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(503).json({ error: 'no store' });

  // Whitelist + truncate: nothing beyond these fields, nothing oversized.
  const row = { at: new Date().toISOString() };
  const body = req.body || {};
  for (const f of FIELDS) {
    const v = body[f];
    if (v == null) continue;
    row[f] = typeof v === 'boolean' ? v : typeof v === 'number' ? v : String(v).slice(0, 120);
  }

  const name = `starts/${row.at.replace(/[:.]/g, '-')}.json`;
  const put = await fetch(`https://blob.vercel-storage.com/${name}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '1',   // two games in the same millisecond both keep their row
    },
    body: JSON.stringify(row),
  });
  if (!put.ok) return res.status(502).json({ error: 'store write failed', status: put.status });
  return res.status(204).end();
};
