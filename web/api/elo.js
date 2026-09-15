// The Elo ladder: username accounts and rated vs-bot games, on the same Vercel
// Blob store as /api/log. Dependency-free.
//
//   GET  /api/elo?action=table            the public leaderboard (HTML)
//   POST { action: 'register', name, pin }
//   POST { action: 'login',    name, pin }        -> { token, name, rating }
//   POST { action: 'report',   token, opponent, difficulty, result }
//                                                 -> { rating, delta }
//
// Accounts are a username + PIN (scrypt-hashed, per-user salt); the login token is
// HMAC-signed with ELO_SECRET and expires in 30 days. Results are reported by the
// player's own client at game end (honor system — this is a friendly ladder, not an
// anti-cheat one). Only games against the bots are rated: each bot × difficulty has
// a fixed rating, so the ladder measures who beats which computer at what level.
const crypto = require('node:crypto');

const K = 32;
const BOT_RATINGS = {
  // ZZZKBot (module 'bot'): brutal rush, but one-dimensional. McRave: the stronger bot.
  bot: { easy: 900, normal: 1200, hard: 1500 },
  mcrave: { easy: 1000, normal: 1350, hard: 1700 },
};
const NAME_RE = /^[a-z0-9_-]{3,16}$/;
const BASE = 'https://blob.vercel-storage.com';

const blobHeaders = (extra = {}) => ({
  authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
  'x-api-version': '7',
  ...extra,
});

async function getUser(name) {
  const r = await fetch(`${BASE}/?prefix=elo/users/${name}.json&limit=1`, { headers: blobHeaders() });
  if (!r.ok) throw new Error('store list failed');
  const { blobs } = await r.json();
  const b = (blobs || []).find((x) => x.pathname === `elo/users/${name}.json`);
  if (!b) return null;
  const u = await fetch(b.url, { cache: 'no-store' });
  return u.ok ? u.json() : null;
}

async function putUser(user) {
  const r = await fetch(`${BASE}/elo/users/${user.name}.json`, {
    method: 'PUT',
    headers: blobHeaders({
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '0',
    }),
    body: JSON.stringify(user),
  });
  if (!r.ok) throw new Error(`store write failed (${r.status})`);
}

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const sign = (payload) => crypto.createHmac('sha256', process.env.ELO_SECRET).update(payload).digest('hex');
const makeToken = (name) => {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  return `${name}.${exp}.${sign(`${name}.${exp}`)}`;
};
function verifyToken(token) {
  const [name, exp, mac] = String(token || '').split('.');
  if (!name || !exp || !mac || +exp < Date.now()) return null;
  const want = sign(`${name}.${exp}`);
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want)) ? name : null;
}

async function table(res) {
  const users = [];
  let cursor = '';
  do {
    const r = await fetch(`${BASE}/?prefix=elo/users/&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { headers: blobHeaders() });
    if (!r.ok) return res.status(502).send('store list failed');
    const page = await r.json();
    for (const b of page.blobs || []) {
      const u = await fetch(b.url, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (u) users.push(u);
    }
    cursor = page.hasMore ? page.cursor : '';
  } while (cursor && users.length < 5000);
  users.sort((a, b) => b.rating - a.rating);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = users.map((u, i) => `<tr><td>${i + 1}</td><td>${esc(u.name)}</td>
    <td><b>${Math.round(u.rating)}</b></td><td>${u.wins}</td><td>${u.losses}</td></tr>`).join('');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=30');
  return res.status(200).send(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenBW ladder</title>
<style>
  body { background:#0b1220; color:#e2e8f0; font: 15px system-ui, sans-serif; margin: 24px auto; max-width: 560px; padding: 0 16px; }
  h1 { font-size: 20px; } .sub { color:#94a3b8; margin: 4px 0 18px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1e293b; }
  th { color:#94a3b8; font-weight: 600; } b { color:#38bdf8; }
  a { color:#38bdf8; }
</style>
<h1>OpenBW — ladder</h1>
<p class="sub">Rated games vs the computer. Sign in from the <a href="/">game lobby</a> to play rated.</p>
<table><tr><th>#</th><th>Player</th><th>Rating</th><th>W</th><th>L</th></tr>${rows}
${rows ? '' : '<tr><td colspan="5" style="color:#64748b">No rated games yet — be the first.</td></tr>'}</table>`);
}

module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.ELO_SECRET)
    return res.status(503).json({ error: 'not configured' });

  if (req.method === 'GET') {
    if ((req.query || {}).action === 'table') return table(res);
    return res.status(400).json({ error: 'unknown action' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = req.body || {};
  const action = String(b.action || '');

  if (action === 'register' || action === 'login') {
    const name = String(b.name || '').toLowerCase().trim();
    const pin = String(b.pin || '');
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'name: 3-16 chars, a-z 0-9 _ -' });
    if (pin.length < 4 || pin.length > 64) return res.status(400).json({ error: 'PIN: at least 4 characters' });
    let user = await getUser(name);
    if (action === 'register') {
      if (user) return res.status(409).json({ error: 'name taken' });
      const salt = crypto.randomBytes(16).toString('hex');
      user = { name, salt, hash: hashPin(pin, salt), rating: 1200, wins: 0, losses: 0,
               created_at: new Date().toISOString() };
      await putUser(user);
    } else {
      if (!user) return res.status(404).json({ error: 'no such player' });
      const want = hashPin(pin, user.salt);
      if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(user.hash)))
        return res.status(403).json({ error: 'wrong PIN' });
    }
    return res.status(200).json({ token: makeToken(name), name, rating: Math.round(user.rating) });
  }

  if (action === 'report') {
    const name = verifyToken(b.token);
    if (!name) return res.status(403).json({ error: 'sign in again' });
    const botElo = (BOT_RATINGS[String(b.opponent)] || {})[String(b.difficulty)];
    if (!botElo) return res.status(400).json({ error: 'not a rated matchup' });
    const won = b.result === 'win';
    if (!won && b.result !== 'loss') return res.status(400).json({ error: 'result?' });
    const user = await getUser(name);
    if (!user) return res.status(404).json({ error: 'no such player' });
    const expected = 1 / (1 + 10 ** ((botElo - user.rating) / 400));
    const delta = K * ((won ? 1 : 0) - expected);
    user.rating += delta;
    won ? user.wins++ : user.losses++;
    await putUser(user);
    return res.status(200).json({ rating: Math.round(user.rating), delta: Math.round(delta) });
  }

  return res.status(400).json({ error: 'unknown action' });
};
