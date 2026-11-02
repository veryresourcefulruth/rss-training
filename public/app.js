/* RSS Childcare 101 — browser app.
   Trainees: sign in with the RSS password, name and a 4-digit PIN. Progress lives on the server.
   Coordinator: sign in with the admin password to preview, edit the course and see the tracker. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => el.hidden = true, 2600); }

/* ---------- session + API ---------- */
const SKEY = "rss101.session";
let session = (() => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } })();
function saveSession(s) { session = s; try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch {} }
async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { "content-type": "application/json" } : {}), ...(session ? { authorization: "Bearer " + session.token } : {}) };
  let res;
  try { res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new Error("Can't reach the server. Check your internet connection and try again."); }
  if (res.status === 401 && session && !path.endsWith("/login")) { saveSession(null); boot(); throw new Error("Your session has ended. Sign in again."); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.blob();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

/* ---------- state ---------- */
let C = null;            // course content
let me = null;           // trainee record
let view = "learn", current = null, quizState = {}, draft = null, trainees = [];
const isAdmin = () => session?.kind === "admin";
const passMark = m => m.critical ? 100 : C.pass;
const passedCount = () => me ? C.modules.filter(m => me.modules[m.id]?.passed).length : 0;
const unlocked = i => isAdmin() || i === 0 || !!me?.modules[C.modules[i - 1].id]?.passed;

/* ---------- boot ---------- */
async function boot() {
  $("#tabs").hidden = true;
  $("#foot").innerHTML = "";
  if (!session) return location.hash === "#coordinator" ? renderAdminLogin() : renderLogin();
  $("#app").innerHTML = `<p class="loading">Loading your training…</p>`;
  try {
    if (isAdmin()) { C = await api("/api/admin/content"); me = null; loadTrainees(); }
    else { [C, me] = await Promise.all([api("/api/content"), api("/api/me")]); }
  } catch (e) { if (session) $("#app").innerHTML = `<div class="panel login"><p class="err">${esc(e.message)}</p><button class="btn" onclick="boot()">Try again</button></div>`; return; }
  $("#tabs").hidden = false;
  $("#tab-cert").hidden = isAdmin();
  $("#tab-track").hidden = !isAdmin();
  $("#foot").innerHTML = `<span>${isAdmin() ? "Signed in as coordinator" : "Signed in as " + esc(me.name)}</span><button id="logout">Sign out</button>`;
  $("#logout").onclick = async () => { try { await api("/api/logout", { method: "POST" }); } catch {} saveSession(null); C = me = null; view = "learn"; current = null; boot(); };
  render();
}
async function loadTrainees() { try { trainees = await api("/api/admin/trainees"); if (view === "track") render(); } catch {} }

/* ---------- sign-in screens ---------- */
function renderLogin() {
  $("#app").innerHTML = `<div class="login"><form class="panel" id="loginForm">
    <p class="eyebrow">Staff sign-in</p><h2>Welcome to RSS</h2>
    <p class="note">Nine short modules on EYFS 2026, safeguarding and working as RSS cover staff. Allow about 3 hours; you can stop and come back on any device.</p>
    <label class="fld" for="lpw">RSS training password<input type="password" id="lpw" autocomplete="current-password" required></label>
    <label class="fld" for="lname">Your full name (first name and surname)<input type="text" id="lname" autocomplete="name" required></label>
    <label class="fld" for="lpin">4-digit PIN<input type="password" id="lpin" class="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></label>
    <p class="note">First time? Choose any 4 digits and remember them. You'll use the same name and PIN to carry on later.</p>
    <p class="err" id="lerr" role="alert"></p>
    <div class="row" style="margin-top:4px"><button class="btn" type="submit" id="lgo">Sign in</button></div>
  </form></div>`;
  $("#foot").innerHTML = `<span>Resourceful Staffing Support</span><button id="toAdmin">Coordinator sign-in</button>`;
  $("#toAdmin").onclick = () => { location.hash = "coordinator"; renderAdminLogin(); };
  $("#loginForm").onsubmit = async e => {
    e.preventDefault(); const btn = $("#lgo"); btn.disabled = true; $("#lerr").textContent = "";
    try {
      const r = await api("/api/login", { method: "POST", body: { password: $("#lpw").value, name: $("#lname").value, pin: $("#lpin").value } });
      saveSession({ kind: "trainee", token: r.token }); boot();
    } catch (err) { $("#lerr").textContent = err.message; btn.disabled = false; }
  };
}
function renderAdminLogin() {
  $("#app").innerHTML = `<div class="login"><form class="panel" id="aForm">
    <p class="eyebrow">Coordinator</p><h2>Coordinator sign-in</h2>
    <label class="fld" for="apw">Coordinator password<input type="password" id="apw" autocomplete="current-password" required></label>
    <p class="err" id="aerr" role="alert"></p>
    <div class="row" style="margin-top:4px"><button class="btn" type="submit" id="ago">Sign in</button></div>
  </form></div>`;
  $("#foot").innerHTML = `<span>Resourceful Staffing Support</span><button id="toStaff">Staff sign-in</button>`;
  $("#toStaff").onclick = () => { history.replaceState(null, "", location.pathname); renderLogin(); };
  $("#aForm").onsubmit = async e => {
    e.preventDefault(); const btn = $("#ago"); btn.disabled = true; $("#aerr").textContent = "";
    try { const r = await api("/api/admin/login", { method: "POST", body: { password: $("#apw").value } }); saveSession({ kind: "admin", token: r.token }); history.replaceState(null, "", location.pathname); boot(); }
    catch (err) { $("#aerr").textContent = err.message; btn.disabled = false; }
  };
}

/* ---------- main layout ---------- */
function render() {
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-pressed", String(t.id === "tab-" + view)));
  if (view === "edit" && draft) { $("#app").innerHTML = `<div class="wrap" style="grid-template-columns:minmax(0,1fr)"><main>${renderEditor()}</main></div>`; wireEditor(); return; }
  if (view === "settings") { $("#app").innerHTML = `<div class="wrap" style="grid-template-columns:minmax(0,1fr)"><main>${renderSettings()}</main></div>`; wireSettings(); return; }
  if (view === "track") { $("#app").innerHTML = `<div class="wrap" style="grid-template-columns:minmax(0,1fr)"><main>${renderTrack()}</main></div>`; wireTrack(); return; }
  $("#app").innerHTML = `<div class="wrap"><aside class="rail"><div class="who" id="who"></div><nav class="cls" id="rail" aria-label="Modules"></nav></aside><main id="main"></main></div>`;
  renderWho(); renderRail();
  if (view === "cert") $("#main").innerHTML = renderCert();
  else {
    const m = C.modules.find(x => x.id === current) || C.modules.find((x, i) => unlocked(i) && !me?.modules[x.id]?.passed) || C.modules[0];
    current = m.id; $("#main").innerHTML = renderModule(m);
  }
  wire();
}
function renderWho() {
  if (isAdmin()) { $("#who").innerHTML = `<b>Coordinator preview</b><span class="note">All modules are open for you. Quiz answers in preview aren't recorded.</span>`; return; }
  const n = passedCount(), pct = Math.round(n / C.modules.length * 100);
  $("#who").innerHTML = `<b>${esc(me.name)}</b><span class="note">${n} of ${C.modules.length} modules passed${me.declaredAt ? " · declaration signed" : ""}</span><div class="meter"><i style="width:${pct}%"></i></div>`;
}
function renderRail() {
  $("#rail").innerHTML = C.classes.map(c => `<h4>${esc(c.name)}</h4>` + C.modules.map((m, i) => [m, i]).filter(([m]) => m.cls === c.id).map(([m, i]) => {
    const r = me?.modules[m.id], open = unlocked(i);
    const chip = r?.passed ? `<span class="chip ok">${r.best}%</span>` : !open ? `<span class="chip lock">Locked</span>` : m.critical ? `<span class="chip crit">100%</span>` : "";
    return `<button class="mod ${r?.passed ? "done" : ""}" data-m="${m.id}" ${open ? "" : "disabled"} aria-current="${current === m.id && view === "learn"}"><span class="num">${r?.passed ? "✓" : i + 1}</span><span class="t">${esc(m.title)}</span>${chip}</button>`;
  }).join("")).join("") + (isAdmin() ? `<div class="owner-tools"><h4>Coordinator</h4>
    <button class="link-btn" id="addMod">+ Add a new module</button>
    <button class="link-btn" id="openSettings">Course settings &amp; passwords</button></div>` : "");
  document.querySelectorAll(".mod").forEach(b => b.onclick = () => { current = b.dataset.m; view = "learn"; quizState = {}; render(); scrollTo({ top: 0 }); });
  const am = $("#addMod"); if (am) am.onclick = () => { draft = { id: "m" + Date.now().toString(36), cls: C.classes[C.classes.length - 1].id, title: "", mins: 15, critical: false, intro: "", body: "<h3>First heading</h3><p>Start writing here.</p>", quiz: [{ q: "", o: ["", ""], a: 0, w: "" }] }; view = "edit"; render(); scrollTo({ top: 0 }); };
  const os = $("#openSettings"); if (os) os.onclick = () => { view = "settings"; render(); scrollTo({ top: 0 }); };
}

/* ---------- module + quiz ---------- */
function renderModule(m) {
  const i = C.modules.indexOf(m), r = me?.modules[m.id], qs = quizState;
  const quiz = m.quiz.map((q, qi) => {
    const a = qs.answers?.[qi], fb = qs.feedback?.[qi];
    return `<fieldset class="q"><legend>${qi + 1}. ${esc(q.q)}</legend>${q.o.map((o, oi) => {
      let cls = ""; if (fb) { if (oi === fb.a && a === oi) cls = "right"; else if (a === oi) cls = "wrong"; }
      return `<label class="opt ${cls}"><input type="radio" name="q${qi}" value="${oi}" ${a === oi ? "checked" : ""} ${fb ? "disabled" : ""}><span>${esc(o)}</span></label>`;
    }).join("")}
    ${fb ? (a !== fb.a ? `<p class="why"><b>Correct answer:</b> ${esc(q.o[fb.a])}. ${esc(fb.w)}</p>` : `<p class="why">${esc(fb.w)}</p>`) : ""}</fieldset>`;
  }).join("");
  let res = "";
  if (qs.feedback) {
    const ok = qs.passed, last = i === C.modules.length - 1;
    res = `<div class="result ${ok ? "pass" : "fail"}" role="status"><strong>${ok ? "Passed" : "Not yet passed"} · ${qs.score}%</strong>${isAdmin() ? "<p class='note'>Preview only: this score isn't recorded.</p>" : ""}
      ${ok ? (last ? "All modules passed. Sign the declaration on My certificate." : "The next module is now open.") : `You need ${qs.passMark}%. Re-read the module, then try again.`}</div>
    <div class="row">${ok && !last ? `<button class="btn" id="next">Go to Module ${i + 2}</button>` : ""}${ok && last && !isAdmin() ? `<button class="btn" id="toCert">Go to My certificate</button>` : ""}${!ok ? `<button class="btn" id="retry">Retake quiz</button>` : ""}</div>`;
  }
  return `<article class="panel">${isAdmin() ? `<div class="row" style="margin:0 0 16px"><button class="btn ghost" id="editMod">Edit this module</button><span class="note">Only coordinators see this.</span></div>` : ""}<div class="reading">
   <p class="eyebrow">Module ${i + 1} · about ${m.mins} min${m.critical ? " · Critical" : ""}</p>
   <h2>${esc(m.title)}</h2><p class="lede">${esc(m.intro)}</p>
   ${r?.passed ? `<p><span class="chip ok">Passed ${fmt(r.passedAt)} · best ${r.best}% · ${r.attempts} attempt${r.attempts > 1 ? "s" : ""}</span></p>` : ""}
   ${m.body}
   <h3 id="quiz" style="margin-top:2em">Quiz · pass mark ${passMark(m)}%</h3>
   <form id="quizForm">${quiz}${qs.feedback ? "" : `<div class="row"><button class="btn" type="submit" id="qgo">Submit answers</button><span class="note" id="qmsg" role="status"></span></div>`}</form>
   ${res}</div></article>`;
}

/* ---------- certificate ---------- */
function renderCert() {
  const n = passedCount();
  if (n < C.modules.length) return `<div class="panel"><div class="reading"><p class="eyebrow">My certificate</p><h2>${n} of ${C.modules.length} modules passed</h2><p>Your certificate appears here once you pass every module and sign the RSS declaration.</p>
  <div class="tbl"><table><thead><tr><th>Module</th><th>Status</th><th>Best</th></tr></thead><tbody>${C.modules.map((m, i) => { const r = me.modules[m.id]; return `<tr><td>${i + 1}. ${esc(m.title)}</td><td>${r?.passed ? "Passed " + fmt(r.passedAt) : r ? "Attempted" : "Not started"}</td><td class="n">${r ? r.best + "%" : "–"}</td></tr>`; }).join("")}</tbody></table></div></div></div>`;
  if (!me.declaredAt) return `<div class="panel"><div class="reading"><p class="eyebrow">Final step</p><h2>RSS practitioner declaration</h2><p>Tick each statement to confirm you understand and will follow it on every RSS placement.</p>
   <form id="declForm">${C.declaration.map((d, i) => `<label class="opt" for="d${i}"><input type="checkbox" id="d${i}" required><span>${esc(d)}</span></label>`).join("")}
   <div class="row"><button class="btn" type="submit">Sign declaration</button><span class="note" id="dmsg" role="status"></span></div></form></div></div>`;
  const refresh = new Date(me.declaredAt); refresh.setFullYear(refresh.getFullYear() + 1);
  return `<div class="cert"><p class="eyebrow">Resourceful Staffing Support</p><h2>Certificate of completion</h2>
   <p>This confirms that</p><p class="name">${esc(me.name)}</p>
   <p>has completed <b>RSS Childcare 101</b>, covering EYFS 2026 essentials, safeguarding and child protection, whistleblowing, intimate care, ratios, safer eating, emergencies and quality practice, passing all ${C.modules.length} assessed modules and signing the RSS practitioner declaration on <b>${fmt(me.declaredAt)}</b>.</p>
   <div class="tbl"><table><thead><tr><th>Module</th><th>Score</th><th>Passed</th></tr></thead><tbody>${C.modules.map((m, i) => { const r = me.modules[m.id]; return `<tr><td>${i + 1}. ${esc(m.title)}</td><td class="n">${r.best}%</td><td class="n">${fmt(r.passedAt)}</td></tr>`; }).join("")}</tbody></table></div>
   <p class="note">Induction training only. Does not replace accredited safeguarding training (required under EYFS 2026) or paediatric first aid certification. Refresh due ${fmt(refresh.toISOString())}.</p></div>
   <div class="panel" style="margin-top:18px"><p style="margin:0"><b>Your result has been sent to RSS automatically.</b> <span class="note">You can print this page or save it as a PDF from your browser's menu for your own records.</span></p></div>`;
}

/* ---------- wiring for learn/cert ---------- */
function wire() {
  const qf = $("#quizForm"); if (qf) qf.onsubmit = async e => {
    e.preventDefault(); const m = C.modules.find(x => x.id === current); const answers = [];
    for (let i = 0; i < m.quiz.length; i++) { const c = qf.querySelector(`input[name=q${i}]:checked`); if (!c) { $("#qmsg").textContent = "Answer every question before submitting."; return; } answers.push(+c.value); }
    if (isAdmin()) {
      const right = m.quiz.filter((q, i) => answers[i] === q.a).length, score = Math.round(right / m.quiz.length * 100);
      quizState = { answers, score, passed: score >= passMark(m), passMark: passMark(m), feedback: m.quiz.map(q => ({ a: q.a, w: q.w })) };
    } else {
      $("#qgo").disabled = true; $("#qmsg").textContent = "Marking…";
      try { const r = await api("/api/quiz", { method: "POST", body: { moduleId: m.id, answers } }); me = r.me; quizState = { answers, ...r }; }
      catch (err) { $("#qmsg").textContent = err.message; $("#qgo").disabled = false; return; }
    }
    render(); document.querySelector(".result")?.scrollIntoView({ block: "center" });
  };
  const em = $("#editMod"); if (em) em.onclick = () => { draft = JSON.parse(JSON.stringify(C.modules.find(x => x.id === current))); view = "edit"; render(); scrollTo({ top: 0 }); };
  const nx = $("#next"); if (nx) nx.onclick = () => { const i = C.modules.findIndex(x => x.id === current); current = C.modules[i + 1].id; quizState = {}; render(); scrollTo({ top: 0 }); };
  const rt = $("#retry"); if (rt) rt.onclick = () => { quizState = {}; render(); $("#quiz").scrollIntoView(); };
  const tc = $("#toCert"); if (tc) tc.onclick = () => { view = "cert"; render(); scrollTo({ top: 0 }); };
  const df = $("#declForm"); if (df) df.onsubmit = async e => {
    e.preventDefault();
    try { me = await api("/api/declare", { method: "POST" }); render(); toast("Declaration signed"); }
    catch (err) { $("#dmsg").textContent = err.message; }
  };
}

/* ---------- coordinator: tracker ---------- */
function traineeDone(t) { return C.modules.every(m => t.modules[m.id]?.passed) && !!t.declaredAt; }
function renderTrack() {
  const done = trainees.filter(traineeDone).length;
  return `<div class="panel"><p class="eyebrow">Coordinator</p><h2>Training tracker</h2>
  <div class="stat-row"><div class="stat"><b>${trainees.length}</b><span>trainees</span></div><div class="stat"><b>${done}</b><span>fully complete</span></div><div class="stat"><b>${trainees.length - done}</b><span>in progress</span></div></div>
  ${trainees.length ? `<div class="tbl"><table><thead><tr><th>Name</th>${C.modules.map((m, i) => `<th title="${esc(m.title)}">M${i + 1}</th>`).join("")}<th>Declaration</th><th>Last seen</th><th></th></tr></thead><tbody>
  ${trainees.map(t => `<tr><td><b>${esc(t.name)}</b> ${traineeDone(t) ? `<span class="tag ok">Complete</span>` : ""}</td>${C.modules.map(m => { const x = t.modules[m.id]; return `<td class="n" title="${x?.passed ? "Passed " + fmt(x.passedAt) + ", " + x.attempts + " attempt(s)" : x ? x.attempts + " attempt(s)" : ""}">${x?.passed ? `<span class="dot y"></span> ${x.best}` : x ? x.best : "–"}</td>`; }).join("")}<td class="n">${t.declaredAt ? fmt(t.declaredAt) : "–"}</td><td class="n">${fmt(t.lastSeenAt)}</td>
  <td><div class="acts"><button class="link-btn" data-pin="${t.id}">Reset PIN</button><button class="link-btn danger" data-del="${t.id}">Remove</button></div></td></tr>`).join("")}</tbody></table></div>
  <div class="row"><button class="btn ghost" id="csv">Download CSV</button><button class="btn ghost" id="refresh">Refresh</button></div>`
    : `<p class="note">No trainees yet. Each person appears here as soon as they sign in for the first time.</p><div class="row"><button class="btn ghost" id="refresh">Refresh</button></div>`}
  <p class="note">Hover over a score to see the pass date. <b>Reset PIN</b> lets a trainee who forgot their PIN choose a new one at their next sign-in; their progress is kept. <b>Remove</b> deletes the trainee and all their results.</p></div>`;
}
function wireTrack() {
  $("#refresh").onclick = async () => { await loadTrainees(); render(); toast("Tracker updated"); };
  const csv = $("#csv"); if (csv) csv.onclick = async () => {
    try { const blob = await api("/api/admin/export.csv"); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `rss-childcare101-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
    catch (e) { toast(e.message); }
  };
  document.querySelectorAll("[data-pin]").forEach(b => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = "Click again to reset"; return; }
    try { await api(`/api/admin/trainees/${b.dataset.pin}/reset-pin`, { method: "POST" }); toast("PIN reset. They choose a new one at next sign-in."); await loadTrainees(); render(); } catch (e) { toast(e.message); }
  });
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = "Click again to delete all their results"; return; }
    try { await api(`/api/admin/trainees/${b.dataset.del}`, { method: "DELETE" }); toast("Trainee removed"); await loadTrainees(); render(); } catch (e) { toast(e.message); }
  });
}

/* ---------- coordinator: module editor ---------- */
function renderQEd(q, qi) {
  return `<fieldset class="qed">
   <div class="qed-head"><b>Question ${qi + 1}</b><button type="button" class="link-btn danger" data-delq="${qi}">Remove question</button></div>
   <label class="fld" for="q${qi}text">Question<textarea class="plain" id="q${qi}text" data-f="q">${esc(q.q)}</textarea></label>
   <span class="note">Answer options. Tick the circle beside the correct one.</span>
   ${q.o.map((o, oi) => `<div class="optrow"><input type="radio" name="corr${qi}" value="${oi}" ${q.a === oi ? "checked" : ""} aria-label="Mark option ${oi + 1} as correct"><input type="text" data-o="${oi}" value="${esc(o)}" placeholder="Option ${oi + 1}">${q.o.length > 2 ? `<button type="button" class="link-btn danger" data-delo="${qi}:${oi}">Remove</button>` : "<span></span>"}</div>`).join("")}
   ${q.o.length < 5 ? `<button type="button" class="link-btn" data-addo="${qi}">+ Add answer option</button>` : ""}
   <label class="fld" for="q${qi}w">Explanation shown after they answer<input type="text" id="q${qi}w" data-f="w" value="${esc(q.w)}"></label>
  </fieldset>`;
}
function renderEditor() {
  const m = draft, isNew = !C.modules.find(x => x.id === m.id);
  return `<div class="panel"><p class="eyebrow">${isNew ? "New module" : "Editing module"} · trainees see your changes as soon as you save</p>
  <h2>${isNew ? "Add a module" : esc(m.title)}</h2>
  <div class="ed-grid">
   <label class="fld" for="edTitle">Title<input type="text" id="edTitle" value="${esc(m.title)}" placeholder="e.g. Working in the baby room"></label>
   <label class="fld" for="edCls">Class<select id="edCls">${C.classes.map(c => `<option value="${c.id}" ${c.id === m.cls ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
   <label class="fld" for="edMins">Minutes<input type="number" id="edMins" min="5" max="240" value="${m.mins}"></label>
  </div>
  <label class="opt" for="edCrit"><input type="checkbox" id="edCrit" ${m.critical ? "checked" : ""}><span>Critical module: trainees need 100% to pass (other modules need ${C.pass}%)</span></label>
  <label class="fld" for="edIntro">Introduction (one or two sentences under the title)<textarea class="plain" id="edIntro" style="max-width:none">${esc(m.intro)}</textarea></label>
  <h3>Module content</h3>
  <p class="note">Click into the text and type as you would in Word. Select text, then use the buttons to format it. Pasted text comes in plain, so add headings and bold afterwards.</p>
  <div class="ed-toolbar" role="toolbar" aria-label="Formatting">
    <button type="button" class="tool" data-cmd="h3">Heading</button>
    <button type="button" class="tool" data-cmd="p">Normal text</button>
    <button type="button" class="tool" data-cmd="bold"><b>Bold</b></button>
    <button type="button" class="tool" data-cmd="ul">Bullet list</button>
    <button type="button" class="tool" data-cmd="ol">Numbered steps</button>
    <button type="button" class="tool accent" data-cmd="exp">+ From Ruth's experience</button>
    <button type="button" class="tool" data-cmd="tip">+ Key point box</button>
  </div>
  <div id="edBody" class="rich" contenteditable="true" aria-label="Module content">${m.body}</div>
  <h3>Quiz</h3>
  <div id="edQuiz">${m.quiz.map(renderQEd).join("")}</div>
  <button type="button" class="btn ghost" id="addQ">+ Add question</button>
  <div class="row sticky-save">
    <button type="button" class="btn" id="edSave">Save and publish</button>
    <button type="button" class="btn ghost" id="edCancel">Cancel</button>
    ${isNew ? "" : `<button type="button" class="link-btn danger" id="edDel">Delete module</button>`}
    <span class="note" id="edMsg" role="status"></span>
  </div></div>`;
}
function readEditor() {
  if (!$("#edTitle")) return;
  draft.title = $("#edTitle").value.trim(); draft.cls = $("#edCls").value; draft.mins = Math.max(5, +$("#edMins").value || 15);
  draft.critical = $("#edCrit").checked; draft.intro = $("#edIntro").value.trim(); draft.body = $("#edBody").innerHTML;
  draft.quiz = [...document.querySelectorAll(".qed")].map((f, qi) => ({
    q: f.querySelector('[data-f="q"]').value.trim(),
    o: [...f.querySelectorAll("[data-o]")].map(i => i.value.trim()),
    a: +(f.querySelector(`input[name="corr${qi}"]:checked`)?.value ?? -1),
    w: f.querySelector('[data-f="w"]').value.trim(),
  }));
}
function cleanHTML(html) {
  const t = document.createElement("template"); t.innerHTML = html;
  t.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,select,textarea,img,video,audio").forEach(n => n.remove());
  t.content.querySelectorAll("*").forEach(el => [...el.attributes].forEach(a => {
    const n = a.name.toLowerCase();
    if (n.startsWith("on") || n === "style" || n === "contenteditable" || n === "id" || ((n === "href" || n === "src") && !/^\s*https?:/i.test(a.value))) el.removeAttribute(a.name);
  }));
  t.content.querySelectorAll("ol").forEach(o => o.className = "steps");
  t.content.querySelectorAll("ul").forEach(u => { if (!u.className) u.className = "list"; });
  t.content.querySelectorAll("a").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
  return t.innerHTML.trim();
}
function sortModules(list) { const order = C.classes.map(c => c.id); return list.map((m, i) => [m, i]).sort((x, y) => (order.indexOf(x[0].cls) - order.indexOf(y[0].cls)) || (x[1] - y[1])).map(x => x[0]); }
async function saveContent(next, msgEl) {
  msgEl.textContent = "Saving…";
  try { C = await api("/api/admin/content", { method: "PUT", body: { ...C, ...next } }); toast("Saved and published"); return true; }
  catch (e) { msgEl.textContent = e.message; return false; }
}
function wireEditor() {
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch {}
  const body = $("#edBody");
  body.addEventListener("paste", e => {
    e.preventDefault(); const t = e.clipboardData.getData("text/plain");
    document.execCommand("insertHTML", false, t.split(/\r?\n\s*\r?\n/).map(p => "<p>" + esc(p).replace(/\r?\n/g, "<br>") + "</p>").join(""));
  });
  const ensureFocus = () => { const s = getSelection(); if (!s.rangeCount || !body.contains(s.anchorNode)) { body.focus(); const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); s.removeAllRanges(); s.addRange(r); } };
  document.querySelectorAll(".tool").forEach(b => {
    b.addEventListener("mousedown", e => e.preventDefault());
    b.onclick = () => {
      ensureFocus(); const c = b.dataset.cmd;
      if (c === "h3" || c === "p") document.execCommand("formatBlock", false, c);
      else if (c === "bold") document.execCommand("bold");
      else if (c === "ul") document.execCommand("insertUnorderedList");
      else if (c === "ol") document.execCommand("insertOrderedList");
      else if (c === "exp") document.execCommand("insertHTML", false, `<div class="callout exp"><b>From Ruth's experience:</b> Type your story or lesson here.</div><p><br></p>`);
      else if (c === "tip") document.execCommand("insertHTML", false, `<div class="callout"><b>Key point:</b> Type the key point here.</div><p><br></p>`);
    };
  });
  const rerender = () => { const y = scrollY; render(); scrollTo({ top: y }); };
  $("#addQ").onclick = () => { readEditor(); draft.quiz.push({ q: "", o: ["", "", "", ""], a: 0, w: "" }); rerender(); };
  document.querySelectorAll("[data-delq]").forEach(b => b.onclick = () => { readEditor(); draft.quiz.splice(+b.dataset.delq, 1); rerender(); });
  document.querySelectorAll("[data-addo]").forEach(b => b.onclick = () => { readEditor(); draft.quiz[+b.dataset.addo].o.push(""); rerender(); });
  document.querySelectorAll("[data-delo]").forEach(b => b.onclick = () => { readEditor(); const [qi, oi] = b.dataset.delo.split(":").map(Number); const q = draft.quiz[qi]; q.o.splice(oi, 1); if (q.a === oi) q.a = -1; else if (q.a > oi) q.a--; rerender(); });
  $("#edCancel").onclick = () => { const ex = C.modules.find(x => x.id === draft.id); draft = null; view = "learn"; if (ex) current = ex.id; quizState = {}; render(); scrollTo({ top: 0 }); };
  const del = $("#edDel"); if (del) del.onclick = async () => {
    if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Click again to delete this module for everyone"; return; }
    const next = C.modules.filter(x => x.id !== draft.id);
    if (await saveContent({ modules: next }, $("#edMsg"))) { draft = null; view = "learn"; current = C.modules[0].id; render(); }
  };
  $("#edSave").onclick = async () => {
    readEditor(); const msg = $("#edMsg"), m = draft;
    if (!m.title) { msg.textContent = "Give the module a title."; $("#edTitle").focus(); return; }
    if (!m.quiz.length) { msg.textContent = "Add at least one quiz question, so trainees have something to pass."; return; }
    for (let i = 0; i < m.quiz.length; i++) {
      const q = m.quiz[i];
      if (!q.q) { msg.textContent = `Question ${i + 1} has no question text.`; return; }
      if (q.o.some(o => !o)) { msg.textContent = `Question ${i + 1} has an empty answer option. Fill it in or remove it.`; return; }
      if (!(q.a >= 0 && q.a < q.o.length)) { msg.textContent = `Question ${i + 1}: tick the correct answer.`; return; }
    }
    const saved = { ...m, body: cleanHTML(m.body) };
    const exists = C.modules.some(x => x.id === m.id);
    const next = sortModules(exists ? C.modules.map(x => x.id === m.id ? saved : x) : [...C.modules, saved]);
    if (await saveContent({ modules: next }, msg)) { draft = null; view = "learn"; current = saved.id; quizState = {}; render(); scrollTo({ top: 0 }); }
  };
}

/* ---------- coordinator: settings ---------- */
function renderSettings() {
  return `<div class="panel set"><p class="eyebrow">Coordinator</p><h2>Course settings</h2>
  <label class="fld" for="sPass">Pass mark for standard modules (%)<input type="number" id="sPass" min="50" max="100" value="${C.pass}" style="max-width:140px"></label>
  <h3>Class names</h3>
  ${C.classes.map((c, i) => `<label class="fld" for="sCls${i}">Class ${esc(c.id)}<input type="text" id="sCls${i}" value="${esc(c.name)}"></label>`).join("")}
  <h3>Practitioner declaration</h3>
  <label class="fld" for="sDecl">One statement per line. Trainees tick each one before getting their certificate.<textarea class="plain" id="sDecl" style="max-width:none;min-height:160px">${esc(C.declaration.join("\n"))}</textarea></label>
  <div class="row"><button class="btn" id="sSave">Save settings</button><button class="btn ghost" id="sCancel">Back to training</button><span class="note" id="sMsg" role="status"></span></div>
  <h3 style="margin-top:2em">Passwords</h3>
  <p class="note">Leave a box blank to keep the current password. At least 8 characters. Changing the staff password doesn't sign anyone out; it only applies to new sign-ins.</p>
  <label class="fld" for="pwStaff">New staff password (shared with all RSS trainees)<input type="text" id="pwStaff" autocomplete="off"></label>
  <label class="fld" for="pwAdmin">New coordinator password<input type="password" id="pwAdmin" autocomplete="new-password"></label>
  <div class="row"><button class="btn" id="pwSave">Change passwords</button><span class="note" id="pwMsg" role="status"></span></div></div>`;
}
function wireSettings() {
  $("#sCancel").onclick = () => { view = "learn"; render(); };
  $("#sSave").onclick = async () => {
    const pass = Math.min(100, Math.max(50, +$("#sPass").value || 80));
    const declaration = $("#sDecl").value.split("\n").map(s => s.trim()).filter(Boolean);
    if (!declaration.length) { $("#sMsg").textContent = "Keep at least one declaration statement."; return; }
    const classes = C.classes.map((c, i) => ({ id: c.id, name: $("#sCls" + i).value.trim() || c.name }));
    if (await saveContent({ pass, declaration, classes }, $("#sMsg"))) $("#sMsg").textContent = "Saved.";
  };
  $("#pwSave").onclick = async () => {
    const staff = $("#pwStaff").value.trim(), admin = $("#pwAdmin").value;
    if (!staff && !admin) { $("#pwMsg").textContent = "Type a new password first."; return; }
    try { await api("/api/admin/passwords", { method: "PUT", body: { staff, admin } }); $("#pwStaff").value = $("#pwAdmin").value = ""; $("#pwMsg").textContent = "Password changed."; }
    catch (e) { $("#pwMsg").textContent = e.message; }
  };
}

$("#tab-learn").onclick = () => { view = "learn"; render(); };
$("#tab-cert").onclick = () => { view = "cert"; render(); };
$("#tab-track").onclick = async () => { view = "track"; render(); await loadTrainees(); render(); };
window.boot = boot;
boot();
