// =====================================================
//  БЕКЕНД «БУКОВЕЛЬ РП»  (Cloudflare Worker)
//  Усі дані (гравці, анкети, лідери) зберігаються у файлі
//  data.json у ПРИВАТНОМУ репозиторії GitHub.
//  Налаштування (змінні середовища) дивись в ІНСТРУКЦІЯ.md
// =====================================================

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
const fail = (s, m, extra) => { throw new HttpError(s, m, extra); };
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- base64 ----------
function b64Enc(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
}
function b64Dec(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); }
const b64u = (bytes) => b64Enc(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64uDec(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return b64Dec(str);
}

// ---------- токени входу ----------
async function hmacKey(env) {
  return crypto.subtle.importKey('raw', enc.encode(env.SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function makeToken(env, key) {
  const p = b64u(enc.encode(JSON.stringify({ n: key, e: Date.now() + 30 * 864e5 })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(p)));
  return p + '.' + b64u(sig);
}
async function readToken(env, req) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const [p, s] = t.split('.');
  if (!p || !s) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64uDec(s), enc.encode(p));
    if (!ok) return null;
    const o = JSON.parse(dec.decode(b64uDec(p)));
    return o.e > Date.now() ? o.n : null;
  } catch (e) { return null; }
}

// ---------- збереження в GitHub ----------
const blank = () => ({ users: {}, apps: [], leaders: {}, seq: 0 });
let cache = null;

const ghUrl = (env) => `https://api.github.com/repos/${env.GH_REPO}/contents/${env.GH_PATH || 'data.json'}`;
const ghHead = (env) => ({
  Authorization: 'Bearer ' + env.GH_TOKEN,
  'User-Agent': 'bukovel-rp-worker',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
});

async function load(env, fresh) {
  if (!fresh && cache && Date.now() - cache.t < 15000) return cache;
  const q = env.GH_BRANCH ? '?ref=' + encodeURIComponent(env.GH_BRANCH) : '';
  const r = await fetch(ghUrl(env) + q, { headers: ghHead(env) });
  if (r.status === 404) { cache = { data: blank(), sha: null, t: Date.now() }; return cache; }
  if (!r.ok) fail(502, 'GitHub недоступний (' + r.status + ')');
  const j = await r.json();
  const data = JSON.parse(dec.decode(b64Dec(String(j.content).replace(/\n/g, ''))));
  data.users = data.users || {}; data.apps = data.apps || []; data.leaders = data.leaders || {}; data.seq = data.seq || 0;
  cache = { data, sha: j.sha, t: Date.now() };
  return cache;
}

async function save(env, data, sha, message) {
  const body = { message, content: b64Enc(enc.encode(JSON.stringify(data, null, 1))) };
  if (sha) body.sha = sha;
  if (env.GH_BRANCH) body.branch = env.GH_BRANCH;
  const r = await fetch(ghUrl(env), {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHead(env)),
    body: JSON.stringify(body)
  });
  if (r.status === 409 || r.status === 422) return false; // файл змінився — повторимо
  if (!r.ok) fail(502, 'Не вдалося зберегти у GitHub (' + r.status + ')');
  const j = await r.json();
  cache = { data, sha: j.content.sha, t: Date.now() };
  return true;
}

async function mutate(env, message, fn) {
  for (let i = 0; i < 4; i++) {
    const { data, sha } = await load(env, true);
    let result;
    try { result = fn(data); } catch (e) { cache = null; throw e; }
    if (await save(env, data, sha, message)) return result;
    cache = null;
  }
  fail(503, 'Забагато одночасних змін, спробуйте ще раз');
}

// ---------- допоміжне ----------
const ownerKey = (env) => String(env.OWNER_TG || '').replace(/^@/, '').toLowerCase();

function normNick(raw) {
  const n = String(raw || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(n)) fail(400, 'Нік у Telegram: 5–32 символи, лише латиниця, цифри та _');
  return n;
}
const facId = (v) => {
  const f = String(v || '');
  if (!/^[a-z0-9]{2,16}$/.test(f)) fail(400, 'Невірна фракція');
  return f;
};
const pubUser = (u) => ({ nick: u.nick, role: u.role, faction: u.faction || null, banned: !!u.banned });
const isStaff = (u) => u.role === 'admin' || u.role === 'owner';

async function authed(req, env) {
  const key = await readToken(env, req);
  if (!key) fail(401, 'Увійдіть в акаунт');
  const { data } = await load(env);
  const u = data.users[key];
  if (!u) fail(401, 'Акаунт не знайдено');
  if (u.banned) fail(403, 'Ваш акаунт заблоковано' + (u.banReason ? ': ' + u.banReason : ''), { banned: true });
  return u;
}
async function adminOnly(req, env) {
  const u = await authed(req, env);
  if (!isStaff(u)) fail(403, 'Немає доступу');
  return u;
}

// ---------- маршрути ----------
async function handle(req, env, path, body) {
  const m = req.method;
  const now = new Date().toISOString();

  // Публічні дані: склад фракцій, лідери, адміністрація (без паролів)
  if (m === 'GET' && path === '/api/state') {
    const { data } = await load(env);
    const members = {};
    const staff = [];
    for (const u of Object.values(data.users)) {
      if (u.banned) continue;
      if (u.faction) (members[u.faction] = members[u.faction] || []).push(u.nick);
      if (isStaff(u)) staff.push({ nick: u.nick, role: u.role });
    }
    const ok = ownerKey(env);
    if (ok && !staff.some((s) => s.role === 'owner')) staff.unshift({ nick: String(env.OWNER_TG).replace(/^@/, ''), role: 'owner' });
    return { members, leaders: data.leaders, staff };
  }

  // Реєстрація
  if (m === 'POST' && path === '/api/register') {
    const nick = normNick(body.tg);
    const key = nick.toLowerCase();
    const pw = String(body.password || '');
    if (pw.length < 6 || pw.length > 64) fail(400, 'Пароль має бути від 6 до 64 символів');
    if (key === ownerKey(env)) fail(403, 'Цей нік зарезервовано');
    const user = await mutate(env, 'Реєстрація @' + nick, (d) => {
      if (d.users[key]) fail(409, 'Цей нік уже зареєстровано. Спробуйте увійти');
      d.users[key] = { nick, password: pw, role: 'player', banned: false, faction: null, created: now };
      return d.users[key];
    });
    return { token: await makeToken(env, key), user: pubUser(user) };
  }

  // Вхід
  if (m === 'POST' && path === '/api/login') {
    const nick = normNick(body.tg);
    const key = nick.toLowerCase();
    const pw = String(body.password || '');
    if (key === ownerKey(env)) {
      if (!env.OWNER_PASSWORD || pw !== env.OWNER_PASSWORD) fail(401, 'Невірний нік або пароль');
      let { data } = await load(env);
      let u = data.users[key];
      if (!u || u.role !== 'owner') {
        u = await mutate(env, 'Створено акаунт власника', (d) => {
          const old = d.users[key] || {};
          d.users[key] = Object.assign({ faction: null, created: now }, old, { nick, role: 'owner', banned: false, password: '(задано у Cloudflare)' });
          return d.users[key];
        });
      }
      return { token: await makeToken(env, key), user: pubUser(u) };
    }
    const { data } = await load(env, true);
    const u = data.users[key];
    if (!u || u.password !== pw) fail(401, 'Невірний нік або пароль');
    if (u.banned) fail(403, 'Ваш акаунт заблоковано' + (u.banReason ? ': ' + u.banReason : ''), { banned: true });
    return { token: await makeToken(env, key), user: pubUser(u) };
  }

  // Мій профіль і мої анкети
  if (m === 'GET' && path === '/api/me') {
    const u = await authed(req, env);
    const { data } = await load(env);
    const apps = data.apps
      .filter((a) => a.nick.toLowerCase() === u.nick.toLowerCase())
      .map((a) => ({ id: a.id, faction: a.faction, status: a.status, created: a.created, decided: a.decided, note: a.note || '' }))
      .reverse();
    return { user: pubUser(u), apps };
  }

  // Подати анкету
  if (m === 'POST' && path === '/api/apply') {
    const u = await authed(req, env);
    const faction = facId(body.faction);
    const answers = Array.isArray(body.answers) ? body.answers.slice(0, 14) : [];
    if (!answers.length) fail(400, 'Анкета порожня');
    const clean = answers.map((x) => ({
      q: String((x && x.q) || '').slice(0, 220),
      a: String((x && x.a) || '').trim().slice(0, 1500)
    }));
    if (clean.some((x) => !x.q || !x.a)) fail(400, 'Заповніть усі поля анкети');
    const key = u.nick.toLowerCase();
    await mutate(env, 'Анкета @' + u.nick + ' → ' + faction, (d) => {
      const me = d.users[key];
      if (!me || me.banned) fail(403, 'Акаунт недоступний');
      if (me.faction) fail(409, 'Ви вже перебуваєте у фракції');
      if (d.apps.some((a) => a.nick.toLowerCase() === key && a.status === 'pending')) fail(409, 'У вас уже є анкета на розгляді');
      d.apps.push({ id: ++d.seq, nick: me.nick, faction, answers: clean, status: 'pending', created: now });
    });
    return { ok: true };
  }

  // ---------- Адмінка ----------
  if (path.startsWith('/api/admin/')) {
    const admin = await adminOnly(req, env);
    const isOwner = admin.role === 'owner';

    if (m === 'GET' && path === '/api/admin/data') {
      const { data } = await load(env, true);
      const users = Object.values(data.users).map((u) => ({
        nick: u.nick, role: u.role, faction: u.faction || null, banned: !!u.banned, banReason: u.banReason || '',
        created: u.created, password: isOwner ? u.password : undefined
      }));
      return { me: pubUser(admin), users, apps: data.apps, leaders: data.leaders };
    }

    if (m === 'POST' && path === '/api/admin/decide') {
      const id = Number(body.id);
      const approve = body.decision === 'approve';
      if (!approve && body.decision !== 'reject') fail(400, 'Невірне рішення');
      await mutate(env, (approve ? 'Схвалено' : 'Відхилено') + ' анкету #' + id, (d) => {
        const app = d.apps.find((a) => a.id === id);
        if (!app) fail(404, 'Анкету не знайдено');
        if (app.status !== 'pending') fail(409, 'Анкету вже розглянуто');
        const u = d.users[app.nick.toLowerCase()];
        if (approve) {
          if (!u) fail(404, 'Гравця не знайдено');
          if (u.banned) fail(400, 'Гравця заблоковано');
          u.faction = app.faction;
        }
        app.status = approve ? 'approved' : 'rejected';
        app.note = String(body.note || '').slice(0, 300);
        app.by = admin.nick;
        app.decided = now;
      });
      return { ok: true };
    }

    if (m === 'POST' && path === '/api/admin/ban') {
      const key = normNick(body.nick).toLowerCase();
      const banned = !!body.banned;
      await mutate(env, (banned ? 'Бан @' : 'Розбан @') + key, (d) => {
        const t = d.users[key];
        if (!t) fail(404, 'Гравця не знайдено');
        if (t.role === 'owner') fail(403, 'Власника не можна заблокувати');
        if (isStaff(t) && !isOwner) fail(403, 'Адміністраторів може блокувати лише власник');
        t.banned = banned;
        t.banReason = banned ? String(body.reason || '').slice(0, 200) : '';
      });
      return { ok: true };
    }

    if (m === 'POST' && path === '/api/admin/role') {
      if (!isOwner) fail(403, 'Призначати адмінів може лише власник');
      const key = normNick(body.nick).toLowerCase();
      const role = body.role === 'admin' ? 'admin' : body.role === 'player' ? 'player' : fail(400, 'Невірна роль');
      await mutate(env, 'Роль @' + key + ': ' + role, (d) => {
        const t = d.users[key];
        if (!t) fail(404, 'Гравця не знайдено');
        if (t.role === 'owner') fail(403, 'Роль власника змінити не можна');
        t.role = role;
      });
      return { ok: true };
    }

    if (m === 'POST' && path === '/api/admin/leader') {
      const faction = facId(body.faction);
      const raw = String(body.leader || '').trim();
      const leader = raw ? normNick(raw) : '';
      await mutate(env, 'Лідер ' + faction + ': ' + (leader || '—'), (d) => {
        if (leader) d.leaders[faction] = leader; else delete d.leaders[faction];
      });
      return { ok: true };
    }

    if (m === 'POST' && path === '/api/admin/setfaction') {
      const key = normNick(body.nick).toLowerCase();
      const faction = body.faction ? facId(body.faction) : null;
      await mutate(env, 'Фракція @' + key + ': ' + (faction || '—'), (d) => {
        const t = d.users[key];
        if (!t) fail(404, 'Гравця не знайдено');
        t.faction = faction;
      });
      return { ok: true };
    }
  }

  fail(404, 'Не знайдено');
}

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400'
    };
    const send = (obj, status) => new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors)
    });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!env.GH_TOKEN || !env.GH_REPO || !env.SECRET) fail(500, 'Сервер не налаштовано (GH_TOKEN, GH_REPO, SECRET)');
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      let body = {};
      if (req.method === 'POST') { try { body = await req.json(); } catch (e) { body = {}; } }
      return send(await handle(req, env, path, body));
    } catch (e) {
      if (e instanceof HttpError) return send(Object.assign({ error: e.message }, e.extra), e.status);
      return send({ error: 'Внутрішня помилка сервера' }, 500);
    }
  }
};
