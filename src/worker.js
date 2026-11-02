// RSS Childcare 101 — Cloudflare Worker API.
// Staff sign in with the shared RSS password + their name + a personal 4-digit PIN (set on first sign-in).
// The coordinator signs in with a separate admin password. Both passwords are stored hashed in D1.
// Quizzes are marked here on the server; trainees never receive the correct answers in advance.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (status, message) => json({ error: message }, status);
const nowIso = () => new Date().toISOString();
const enc = new TextEncoder();

// ---------- crypto helpers ----------
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const ITER = 100000;
export async function hashSecret(secret, salt = crypto.getRandomValues(new Uint8Array(16)), iter = ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${b64(salt)}$${b64(bits)}`;
}
async function verifySecret(secret, stored) {
  if (!stored || !stored.startsWith("pbkdf2$")) return false;
  const [, iter, salt, want] = stored.split("$");
  const got = (await hashSecret(secret, unb64(salt), +iter)).split("$")[3];
  if (got.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// ---------- settings ----------
async function getSetting(env, key) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  return r ? r.value : null;
}
const setSetting = (env, key, value) =>
  env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(key, value, nowIso()).run();
// The course as it stood when it moved from Claude. Used once, to fill an empty database;
// after that the coordinator's saved edits in D1 are the only source.
import SEED from "../seed/content.json";
async function getContent(env) {
  const raw = await getSetting(env, "content");
  if (raw) return JSON.parse(raw);
  await env.DB.prepare("INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES ('content',?,?)").bind(JSON.stringify(SEED), nowIso()).run();
  return JSON.parse(await getSetting(env, "content"));
}
const passMark = (c, m) => (m.critical ? 100 : c.pass || 80);

// Content for trainees: same as stored, minus correct answers and explanations.
function publicContent(c) {
  return {
    pass: c.pass, whatsapp: c.whatsapp || "", classes: c.classes, declaration: c.declaration,
    modules: c.modules.map(m => ({ ...m, quiz: m.quiz.map(q => ({ q: q.q, o: q.o })) })),
  };
}

// ---------- sessions ----------
const DAY = 86400000;
async function createSession(env, kind, traineeId) {
  const token = randomHex(32);
  const ttl = kind === "admin" ? 12 * 3600000 : 60 * DAY;
  await env.DB.prepare("INSERT INTO sessions(token_hash,kind,trainee_id,expires_at) VALUES (?,?,?,?)")
    .bind(await sha256(token), kind, traineeId || null, new Date(Date.now() + ttl).toISOString()).run();
  return token;
}
async function readSession(env, req) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").bind(await sha256(m[1]), nowIso()).first();
  return s || null;
}

// ---------- login rate limit (10 failed tries per 15 minutes per address) ----------
const ipOf = req => req.headers.get("cf-connecting-ip") || "unknown";
async function tooManyFailures(env, req) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const r = await env.DB.prepare("SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND at>?").bind(ipOf(req), since).first();
  return (r?.n || 0) >= 10;
}
async function recordFailure(env, req) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO login_attempts(ip,at) VALUES (?,?)").bind(ipOf(req), nowIso()),
    env.DB.prepare("DELETE FROM login_attempts WHERE at<?").bind(new Date(Date.now() - DAY).toISOString()),
  ]);
}

// ---------- trainees ----------
const nameKey = n => String(n || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cleanText = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
async function traineeView(env, id) {
  const t = await env.DB.prepare("SELECT id,name,uni,created_at,declared_at FROM trainees WHERE id=?").bind(id).first();
  if (!t) return null;
  const { results } = await env.DB.prepare("SELECT module_id,attempts,best,passed,passed_at,last_at FROM results WHERE trainee_id=?").bind(id).all();
  const modules = {};
  for (const r of results) modules[r.module_id] = { attempts: r.attempts, best: r.best, passed: !!r.passed, passedAt: r.passed_at, lastAt: r.last_at };
  return { id: t.id, name: t.name, uni: t.uni || "", startedAt: t.created_at, declaredAt: t.declared_at, modules };
}

// ---------- content validation (coordinator edits) ----------
function validateContent(c) {
  const err = m => { throw new Error(m); };
  if (!c || typeof c !== "object") err("Content is missing.");
  const pass = Number(c.pass);
  if (!(pass >= 50 && pass <= 100)) err("Pass mark must be between 50 and 100.");
  if (!Array.isArray(c.classes) || !c.classes.length) err("At least one class is needed.");
  const classIds = new Set(c.classes.map(x => x.id));
  if (!Array.isArray(c.modules) || !c.modules.length) err("At least one module is needed.");
  const ids = new Set();
  c.modules.forEach((m, i) => {
    const where = `Module ${i + 1}`;
    if (!m.id || ids.has(m.id)) err(`${where} has a missing or duplicate id.`); ids.add(m.id);
    if (!classIds.has(m.cls)) err(`${where} is in a class that doesn't exist.`);
    if (!cleanText(m.title, 200)) err(`${where} needs a title.`);
    if (!Array.isArray(m.quiz) || !m.quiz.length) err(`${where} needs at least one quiz question.`);
    m.quiz.forEach((q, qi) => {
      if (!cleanText(q.q, 2000)) err(`${where}, question ${qi + 1} has no text.`);
      if (!Array.isArray(q.o) || q.o.length < 2 || q.o.some(o => !cleanText(o, 1000))) err(`${where}, question ${qi + 1} needs at least two filled-in options.`);
      if (!(Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length)) err(`${where}, question ${qi + 1} has no correct answer marked.`);
    });
  });
  if (!Array.isArray(c.declaration) || !c.declaration.length) err("Keep at least one declaration statement.");
  if (JSON.stringify(c).length > 900000) err("The course content is too large to save.");
  return {
    pass, whatsapp: String(c.whatsapp || "").replace(/\D/g, "").slice(0, 16),
    classes: c.classes.map(x => ({ id: String(x.id), name: cleanText(x.name, 120) })),
    declaration: c.declaration.map(d => cleanText(d, 500)).filter(Boolean),
    modules: c.modules.map(m => ({
      id: String(m.id), cls: String(m.cls), title: cleanText(m.title, 200), mins: Math.min(240, Math.max(5, Number(m.mins) || 15)),
      critical: !!m.critical, intro: String(m.intro || "").slice(0, 2000), body: String(m.body || ""),
      quiz: m.quiz.map(q => ({ q: String(q.q).trim(), o: q.o.map(o => String(o).trim()), a: q.a, w: String(q.w || "").trim() })),
    })),
  };
}

const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

// ---------- router ----------
async function api(req, env, url) {
  const p = url.pathname, method = req.method;
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  if (p === "/api/login" && method === "POST") {
    if (await tooManyFailures(env, req)) return fail(429, "Too many unsuccessful sign-in attempts. Wait 15 minutes and try again.");
    const b = await body();
    const name = cleanText(b.name, 80), key = nameKey(name), pin = String(b.pin || "");
    if (!(await verifySecret(String(b.password || ""), await getSetting(env, "staff_password")))) {
      await recordFailure(env, req); return fail(401, "That RSS password isn't right. Check it with your coordinator.");
    }
    if (key.length < 3 || !/\s/.test(key)) return fail(400, "Enter your first name and surname.");
    if (!/^\d{4}$/.test(pin)) return fail(400, "Your PIN must be 4 digits.");
    let t = await env.DB.prepare("SELECT * FROM trainees WHERE name_key=?").bind(key).first();
    if (!t) {
      const id = randomHex(8);
      await env.DB.prepare("INSERT INTO trainees(id,name,name_key,uni,pin_hash,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)")
        .bind(id, name, key, cleanText(b.uni, 120) || null, await hashSecret(pin), nowIso(), nowIso()).run();
      t = { id };
    } else if (!t.pin_hash) {
      await env.DB.prepare("UPDATE trainees SET pin_hash=?, last_seen_at=? WHERE id=?").bind(await hashSecret(pin), nowIso(), t.id).run();
    } else if (!(await verifySecret(pin, t.pin_hash))) {
      await recordFailure(env, req);
      return fail(401, "That name is already registered with a different PIN. If it's you and you've forgotten your PIN, ask your RSS coordinator to reset it.");
    } else {
      await env.DB.prepare("UPDATE trainees SET last_seen_at=? WHERE id=?").bind(nowIso(), t.id).run();
    }
    return json({ token: await createSession(env, "trainee", t.id), me: await traineeView(env, t.id) });
  }

  if (p === "/api/admin/login" && method === "POST") {
    if (await tooManyFailures(env, req)) return fail(429, "Too many unsuccessful sign-in attempts. Wait 15 minutes and try again.");
    const b = await body();
    if (!(await verifySecret(String(b.password || ""), await getSetting(env, "admin_password")))) {
      await recordFailure(env, req); return fail(401, "That coordinator password isn't right.");
    }
    return json({ token: await createSession(env, "admin") });
  }

  const s = await readSession(env, req);
  if (!s) return fail(401, "Your session has ended. Sign in again.");

  if (p === "/api/logout" && method === "POST") {
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization"));
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(m[1])).run();
    return json({ ok: true });
  }

  // ----- trainee -----
  if (s.kind === "trainee") {
    if (p === "/api/content" && method === "GET") return json(publicContent(await getContent(env)));
    if (p === "/api/me" && method === "GET") {
      const me = await traineeView(env, s.trainee_id);
      return me ? json(me) : fail(401, "Your record no longer exists. Sign in again.");
    }
    if (p === "/api/quiz" && method === "POST") {
      const b = await body(), c = await getContent(env);
      const idx = c.modules.findIndex(m => m.id === b.moduleId);
      if (idx < 0) return fail(404, "That module no longer exists. Reload the page.");
      const m = c.modules[idx], me = await traineeView(env, s.trainee_id);
      for (let i = 0; i < idx; i++) if (!me.modules[c.modules[i].id]?.passed) return fail(403, "Pass the earlier modules first.");
      const ans = Array.isArray(b.answers) ? b.answers : [];
      if (ans.length !== m.quiz.length || ans.some(a => !Number.isInteger(a))) return fail(400, "Answer every question before submitting. If you have, reload the page: the quiz may have been updated.");
      const right = m.quiz.filter((q, i) => ans[i] === q.a).length;
      const score = Math.round((right / m.quiz.length) * 100), mark = passMark(c, m), ok = score >= mark, now = nowIso();
      await env.DB.prepare(`INSERT INTO results(trainee_id,module_id,attempts,best,passed,passed_at,last_at) VALUES (?,?,1,?,?,?,?)
        ON CONFLICT(trainee_id,module_id) DO UPDATE SET attempts=attempts+1, best=MAX(best,excluded.best),
        passed=MAX(passed,excluded.passed), passed_at=COALESCE(passed_at,excluded.passed_at), last_at=excluded.last_at`)
        .bind(s.trainee_id, m.id, score, ok ? 1 : 0, ok ? now : null, now).run();
      return json({ score, passed: ok, passMark: mark, feedback: m.quiz.map(q => ({ a: q.a, w: q.w })), me: await traineeView(env, s.trainee_id) });
    }
    if (p === "/api/declare" && method === "POST") {
      const c = await getContent(env), me = await traineeView(env, s.trainee_id);
      if (!c.modules.every(m => me.modules[m.id]?.passed)) return fail(403, "Pass every module before signing the declaration.");
      await env.DB.prepare("UPDATE trainees SET declared_at=? WHERE id=?").bind(nowIso(), s.trainee_id).run();
      return json(await traineeView(env, s.trainee_id));
    }
    return fail(404, "Not found");
  }

  // ----- coordinator -----
  if (p === "/api/admin/content" && method === "GET") return json(await getContent(env));
  if (p === "/api/admin/content" && method === "PUT") {
    let c; try { c = validateContent(await body()); } catch (e) { return fail(400, e.message); }
    await setSetting(env, "content", JSON.stringify(c));
    return json(c);
  }
  if (p === "/api/admin/trainees" && method === "GET") {
    const { results: ts } = await env.DB.prepare("SELECT id FROM trainees ORDER BY name COLLATE NOCASE").all();
    const out = [];
    for (const t of ts) out.push({ ...(await traineeView(env, t.id)), lastSeenAt: (await env.DB.prepare("SELECT last_seen_at FROM trainees WHERE id=?").bind(t.id).first())?.last_seen_at });
    return json(out);
  }
  let mm;
  if ((mm = /^\/api\/admin\/trainees\/([0-9a-f]{16})\/reset-pin$/.exec(p)) && method === "POST") {
    await env.DB.batch([
      env.DB.prepare("UPDATE trainees SET pin_hash='' WHERE id=?").bind(mm[1]),
      env.DB.prepare("DELETE FROM sessions WHERE trainee_id=?").bind(mm[1]),
    ]);
    return json({ ok: true });
  }
  if ((mm = /^\/api\/admin\/trainees\/([0-9a-f]{16})$/.exec(p)) && method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM results WHERE trainee_id=?").bind(mm[1]),
      env.DB.prepare("DELETE FROM sessions WHERE trainee_id=?").bind(mm[1]),
      env.DB.prepare("DELETE FROM trainees WHERE id=?").bind(mm[1]),
    ]);
    return json({ ok: true });
  }
  if (p === "/api/admin/passwords" && method === "PUT") {
    const b = await body();
    for (const [field, key, label] of [["staff", "staff_password", "Staff"], ["admin", "admin_password", "Coordinator"]]) {
      if (b[field] == null || b[field] === "") continue;
      if (String(b[field]).length < 8) return fail(400, `${label} password must be at least 8 characters.`);
    }
    if (b.staff) await setSetting(env, "staff_password", await hashSecret(String(b.staff)));
    if (b.admin) {
      await setSetting(env, "admin_password", await hashSecret(String(b.admin)));
      await env.DB.prepare("DELETE FROM sessions WHERE kind='admin' AND token_hash<>?").bind(await sha256(/^Bearer (.+)$/.exec(req.headers.get("authorization"))[1])).run();
    }
    return json({ ok: true });
  }
  if (p === "/api/admin/export.csv" && method === "GET") {
    const c = await getContent(env);
    const { results: ts } = await env.DB.prepare("SELECT id FROM trainees ORDER BY name COLLATE NOCASE").all();
    const rows = [["Name", "Started", ...c.modules.map((m, i) => `M${i + 1} ${m.title}`), "Declaration", "Complete"]];
    for (const { id } of ts) {
      const t = await traineeView(env, id);
      const done = c.modules.every(m => t.modules[m.id]?.passed) && !!t.declaredAt;
      rows.push([t.name, t.startedAt.slice(0, 10), ...c.modules.map(m => { const r = t.modules[m.id]; return r?.passed ? `Passed ${r.passedAt.slice(0, 10)} (${r.best}%)` : r ? `Not passed (best ${r.best}%)` : ""; }), t.declaredAt ? t.declaredAt.slice(0, 10) : "", done ? "Yes" : "No"]);
    }
    return new Response(rows.map(r => r.map(csvCell).join(",")).join("\r\n"), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rss-childcare101-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  }
  return fail(404, "Not found");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(req, env, url); }
      catch (e) { console.error(e); return fail(500, "Something went wrong on the server. Try again in a moment."); }
    }
    return env.ASSETS.fetch(req);
  },
};
