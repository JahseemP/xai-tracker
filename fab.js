// Fab Tracker: a spreadsheet of pieces per project, saved to Supabase (table fab_pieces), with the
// Material column worked out live from the Yard Inventory (raw_steel + every tracker's fab-complete pieces).
(function () {
  "use strict";
  const Y = window.YC;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  function toast(msg, ms = 2800) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms); }
  const shortDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };

  // ---------- columns ----------
  const COLS = [
    { k: "active", h: "★", w: 30, type: "star" },
    { k: "dh", h: "DH", w: 92, list: "dh" },
    { k: "mark", h: "Piece mark", w: 100, mono: 1 },
    { k: "xref", h: "Xref", w: 86 },
    { k: "type", h: "Type", w: 78, list: "type" },
    { k: "size", h: "Size", w: 92, mono: 1, list: "size" },
    { k: "length", h: "Length", w: 108, mono: 1 },
    { k: "grade", h: "Grade", w: 62, list: "grade" },
    { k: "drawings", h: "Drawings", w: 74, list: "drawings" },
    { k: "shop", h: "Fab shop", w: 168, list: "shop" },
    { k: "fabStart", h: "Fab start", w: 76, type: "date" },
    { k: "fabComplete", h: "Fab complete", w: 90, type: "date" },
    { k: "shipped", h: "Shipped", w: 76, type: "date" },
    { k: "installed", h: "Installed", w: 76, type: "date" },
    { k: "siteNeed", h: "Site need", w: 76, type: "date" },
    { k: "notes", h: "Notes", w: 150 },
    { k: "_status", h: "Status", w: 96, ro: 1 },
    { k: "_material", h: "Material", w: 210, ro: 1 },
  ];
  const EDIT = COLS.filter((c) => !c.ro).map((c) => c.k);
  const FROZEN = 3; // ★, DH, Piece mark stay put when scrolling right
  const fzLeft = (i) => 44 + COLS.slice(0, i).reduce((a, c) => a + c.w, 0);
  const frozenOn = () => window.innerWidth > 760; // on a phone there's no room to pin columns
  const fzAttr = (i) => (i < FROZEN && frozenOn() ? ` style="left:${fzLeft(i)}px"` : "");
  const fzCls = (i) => (i < FROZEN && frozenOn() ? " fz" + (i === FROZEN - 1 ? " lastfz" : "") : "");
  const LETTERS = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // header names (from Excel) → column
  const ALIASES = [
    ["mark", /^piece ?mark$|^piece$|^mark$|^pc ?mark$/], ["dh", /^dh$|^job ?#?$|^area$|^data ?hall$/], ["xref", /^x-?ref/], ["type", /^type$|^member type$/],
    ["size", /^size$|^main material$|^shape$|^section$|^profile$/], ["length", /^length$|^main length$|^lgth$/], ["grade", /^grade$/],
    ["drawings", /^drawings?( received)?$|^dwgs?$/], ["shop", /^fab ?shop$|^shop$|^fabricated at$/], ["fabStart", /^fab ?start/],
    ["fabComplete", /^fab ?complete|^date complete/], ["shipped", /^shipped|^ship date/], ["installed", /^installed/],
    ["siteNeed", /^site need|^need date/], ["notes", /^notes?$|^comments?$/], ["active", /^★$|^active$|^priority$/],
  ];
  const colFromHeader = (h) => { const t = String(h || "").trim().toLowerCase().replace(/\s+/g, " "); if (!t) return null; for (const [k, re] of ALIASES) if (re.test(t)) return k; return null; };

  // ---------- data ----------
  // pieces: id -> { id, project, sort, data:{...} }
  const pieces = new Map();
  let projects = [], curProj = "", view = "grid";
  let storedRows = [], feeds = new Map(), mat = new Map(), shortBy = new Map(), loaded = false;
  const st = { f: "all", m: "", q: "", size: "" };
  let projOrder = [];
  try { curProj = localStorage.getItem("xai-fab-project") || ""; view = localStorage.getItem("xai-fab-view") || "grid"; } catch (e) { /* storage blocked */ }

  const val = (p, k) => (p.data[k] == null ? "" : p.data[k]);
  function statusOf(p) {
    const d = p.data;
    if (d.installed) return ["Installed", "in"]; if (d.shipped) return ["In Transit", "tr"];
    if (d.fabComplete) return ["Fab Complete", "fc"]; if (d.fabStart) return ["In Fab", "if"];
    return ["Not Started", "ns"];
  }
  const isDone = (p) => !!(p.data.fabComplete || p.data.shipped || p.data.installed);
  const otherShop = (p) => p.data.shop && !Y.isLakeview(p.data.shop);

  function projPieces(name) { return [...pieces.values()].filter((p) => p.project === name).sort((a, b) => a.sort - b.sort); }
  function rebuildProjects() {
    const names = new Set([...pieces.values()].map((p) => p.project));
    projOrder.forEach((n) => names.add(n));
    projects = [...names].filter(Boolean).sort((a, b) => (projOrder.indexOf(a) + 1 || 999) - (projOrder.indexOf(b) + 1 || 999) || a.localeCompare(b));
    if (!projects.includes(curProj)) curProj = projects[0] || "";
  }

  // rows shown = current project, filtered
  let rows = [];
  const filtersOn = () => st.f !== "all" || st.m || st.q.trim() || st.size;
  function computeRows() {
    let list = projPieces(curProj);
    const q = st.q.trim();
    const qList = q && /[\n,;\t]| {2,}/.test(q) ? new Set(q.split(/[\n,;\t]+| {2,}/).map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;
    list = list.filter((p) => {
      const s = statusOf(p)[1];
      if (st.f === "ns" && s !== "ns") return false;
      if (st.f === "if" && s !== "if") return false;
      if (st.f === "fc" && !isDone(p)) return false;
      const m = mat.get(p.id);
      if (st.m === "active" && !p.data.active) return false;
      if (st.m === "out" && !(m && (m.s === "out" || m.s === "na"))) return false;
      if (st.m === "low" && !(m && m.s === "low")) return false;
      if (st.size && Y.normSize(p.data.size) !== st.size) return false;
      if (qList) return qList.has(String(p.data.mark || "").trim().toLowerCase());
      if (q) { const hay = [p.data.mark, p.data.size, p.data.xref, p.data.dh, p.data.type, p.data.shop, p.data.notes].join(" ").toLowerCase(); if (!hay.includes(q.toLowerCase())) return false; }
      return true;
    });
    rows = list;
  }

  // ---------- material from the yard ----------
  function computeMaterial() {
    mat = new Map(); shortBy = new Map();
    // stored lines of sheets that have a feed are replaced by that feed (same as the Yard Inventory page)
    const fed = [...feeds.keys()];
    const base = storedRows.filter((r) => !(String(r.id || "").startsWith("fab-") && fed.some((sk) => r.id.startsWith("fab-" + sk + "-"))));
    const yard = Y.makeYard(base);
    // 1) everything already fab complete (Excel/upload feeds + every project here), oldest first
    const done = [];
    feeds.forEach((f) => {
      if (Number(f.v) < 2 || f.retired) return;
      (f.rows || []).forEach((x, i) => { if (!x || !x[1]) return; const q = String(x[5] ?? "").trim(); done.push({ size: Y.normSize(x[2]), len: Y.normLen(String(x[3] || "")), raw: String(x[4] || ""), qty: q === "" ? 1 : Number(q) || 1, date: Y.cellDate(x[6]) || Y.todayIso(), key: f.sheet + "|" + String(i).padStart(6, "0") }); });
    });
    pieces.forEach((p) => {
      if (!p.data.fabComplete || otherShop(p) || !p.data.shop) return; // only Lakeview pieces use yard steel
      if (p.data.fabComplete < Y.FAB_START) return;
      done.push({ id: p.id, size: Y.normSize(p.data.size), len: p.data.length, raw: "", qty: 1, date: p.data.fabComplete, key: p.project + "|" + String(p.sort).padStart(12, "0") });
    });
    done.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    done.forEach((d) => { if (!yard.stocked.has(d.size)) return; for (let u = 0; u < d.qty; u++) { const t = yard.take(d.size, d.len, d.raw, true); if (d.id && t) mat.set(d.id, { s: "done", t: "Cut from " + t.stock + (t.isStd ? " bar" : " drop") }); } });
    // 2) pieces still to make: ★ active first, then everything else, top to bottom (project tab order)
    const order = (p) => [projects.indexOf(p.project), p.sort];
    const todo = [...pieces.values()].filter((p) => !isDone(p) && p.data.mark && p.data.size);
    todo.sort((a, b) => (b.data.active ? 1 : 0) - (a.data.active ? 1 : 0) || order(a)[0] - order(b)[0] || a.sort - b.sort);
    for (const p of todo) {
      const size = Y.normSize(p.data.size);
      if (otherShop(p)) { mat.set(p.id, { s: "other", t: "Fab at " + p.data.shop + " – not from the yard" }); continue; }
      if (!yard.stocked.has(size)) { mat.set(p.id, { s: "na", t: "Not stocked in yard" }); bump(size, p, "Not in yard"); continue; }
      const t = yard.take(size, p.data.length, "", false);
      if (!t) { const lg = yard.longest(size); mat.set(p.id, { s: "out", t: lg ? "Short – nothing long enough (longest " + lg + ")" : "Short – none left" }); bump(size, p, lg ? "Nothing long enough" : "All used"); continue; }
      const left = yard.leftFor(size, p.data.length);
      mat.set(p.id, { s: left <= 2 ? "low" : "ok", t: (t.stock + (t.isStd ? " bar" : " drop")) + (left <= 2 ? (left === 0 ? " – last one" : " – only " + left + " more") : " – " + left + " left") });
    }
    pieces.forEach((p) => { if (isDone(p) && !mat.has(p.id)) mat.set(p.id, { s: "done", t: otherShop(p) ? "Done (" + p.data.shop + ")" : p.data.fabComplete && p.data.fabComplete < Y.FAB_START ? "Done (before 11/22)" : "Done" }); });
    function bump(size, p, why) { const v = shortBy.get(size) || { n: 0, why: new Map(), proj: new Map() }; v.n++; v.why.set(why, (v.why.get(why) || 0) + 1); v.proj.set(p.project, (v.proj.get(p.project) || 0) + 1); shortBy.set(size, v); }
  }

  // ---------- rendering ----------
  let sel = { r0: 0, c0: 1, r1: 0, c1: 1 }, cur = { r: 0, c: 1 };
  const ROWH = 25, OVERSCAN = 12;
  const selBox = () => ({ r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1), c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1) });
  let newIds = new Set();

  function renderAll() {
    rebuildProjects(); computeRows();
    renderTabs(); renderKpis(); renderSide(); renderDatalists();
    document.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === st.f)));
    document.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === st.m)));
    document.querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === view)));
    $("gscroll").hidden = view !== "grid"; $("fbar").hidden = view !== "grid"; $("keys").hidden = view !== "grid"; $("listView").hidden = view !== "list";
    $("pTitle").textContent = curProj || "Fab Tracker";
    if (view === "grid") renderGrid(); else renderList();
  }
  function renderTabs() {
    $("ptabs").innerHTML = projects.map((n) => `<button role="tab" type="button" data-p="${esc(n)}" aria-selected="${n === curProj}">${esc(n)}<span class="n">${fmt(projPieces(n).length)}</span></button>`).join("") + `<button type="button" id="addProj">+ Project</button>`;
  }
  function renderKpis() {
    const list = projPieces(curProj);
    const c = { fc: 0, if: 0, ok: 0, low: 0, out: 0 };
    list.forEach((p) => { const s = statusOf(p)[1]; if (isDone(p)) c.fc++; else if (s === "if") c.if++; const m = mat.get(p.id); if (m && !isDone(p)) { if (m.s === "ok") c.ok++; else if (m.s === "low") c.low++; else if (m.s === "out" || m.s === "na") c.out++; } });
    $("kp").innerHTML = `<div><div class="l">Pieces</div><div class="v">${fmt(list.length)}</div></div><div><div class="l">Fab complete</div><div class="v g">${fmt(c.fc)}</div></div><div><div class="l">In fab</div><div class="v">${fmt(c.if)}</div></div><div><div class="l">Have material</div><div class="v g">${fmt(c.ok)}</div></div><div><div class="l">Low</div><div class="v" style="color:#8a5a00">${fmt(c.low)}</div></div><div><div class="l">Lacking material</div><div class="v r">${fmt(c.out)}</div></div>`;
  }
  function renderSide() {
    const list = [...shortBy.entries()].map(([s, v]) => [s, v.proj.get(curProj) || 0, v]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...list.map((x) => x[1]));
    $("side").innerHTML = `<h3>Short by size</h3>` + (list.length ? list.map(([s, n, v]) => `<button type="button" class="bay" data-size="${esc(s)}" aria-pressed="${st.size === s}"><span class="mono">${esc(s)}</span><span class="bv">${fmt(n)}</span><span class="bar"><i style="width:${Math.round(100 * n / mx)}%"></i></span><span class="bs">${esc([...v.why.entries()].sort((a, b) => b[1] - a[1])[0][0])}</span></button>`).join("") + `<div class="hint">Click a size to see its pieces${st.size ? ' · <a href="#" id="clrSize">show all</a>' : ""}. Updates as soon as steel is received in the yard.</div>` : `<div class="hint">${loaded ? "Nothing short in this project." : "Loading…"}</div>`);
  }
  function renderDatalists() {
    const vals = (k, extra = []) => [...new Set(extra.concat([...pieces.values()].map((p) => p.data[k]).filter(Boolean)))].sort();
    const sizes = new Set(vals("size")); storedRows.forEach((r) => { if ((r.item_type || "steel") === "steel" && Number(r.qty) > 0) sizes.add(r.size); });
    const fill = (id, arr) => { $(id).innerHTML = arr.map((v) => `<option value="${esc(v)}">`).join(""); };
    fill("dl-size", [...sizes].sort(Y.sizeSort)); fill("dl-shop", vals("shop", ["Lake View Lot – Memphis", "Houma"])); fill("dl-dh", vals("dh")); fill("dl-type", vals("type", ["Column", "Beam", "L Brace", "HSS Kicker", "Brace"]));
    fill("dl-grade", vals("grade", ["A992", "A36", "A500", "A572-50"])); fill("dl-drawings", vals("drawings", ["Yes", "See JP", "No"]));
  }
  function cellHtml(p, ci, r) {
    const c = COLS[ci]; const cls = [];
    let v = "";
    if (c.k === "_status") { const [t, k] = statusOf(p); v = t; cls.push({ fc: "pg", in: "pg", if: "pw", tr: "pw", ns: "pm" }[k], "ro"); }
    else if (c.k === "_material") { const m = mat.get(p.id); v = m ? m.t : ""; cls.push("ro", m ? { ok: "pg", low: "pl", out: "po", na: "po", done: "pm", other: "pm" }[m.s] : ""); }
    else if (c.type === "star") { v = p.data.active ? "★" : "☆"; cls.push("star"); if (p.data.active) cls.push("on"); }
    else if (c.type === "date") { const d = val(p, c.k); v = /^\d{4}-\d{2}-\d{2}$/.test(d) ? shortDate(d) : d; cls.push("dt"); if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) cls.push("bad"); }
    else { v = val(p, c.k); if (c.mono) cls.push("mono"); }
    const b = selBox(); if (r >= b.r0 && r <= b.r1 && ci >= b.c0 && ci <= b.c1) cls.push("sel");
    if (r === cur.r && ci === cur.c) cls.push("cur");
    return `<td class="${cls.join(" ")}${fzCls(ci)}"${fzAttr(ci)} data-r="${r}" data-c="${ci}" title="${esc(v)}">${esc(v)}</td>`;
  }
  function renderGrid() {
    const sc = $("gscroll"), b = selBox();
    const total = rows.length + 1; // + "add row" line
    const first = Math.max(0, Math.floor(sc.scrollTop / ROWH) - OVERSCAN), last = Math.min(total - 1, Math.ceil((sc.scrollTop + sc.clientHeight) / ROWH) + OVERSCAN);
    let h = `<colgroup><col style="width:44px">${COLS.map((c) => `<col style="width:${c.w}px">`).join("")}</colgroup><thead><tr class="cl"><th class="rn"></th>${COLS.map((c, i) => `<th class="${i >= b.c0 && i <= b.c1 ? "hl" : ""}${fzCls(i)}"${fzAttr(i)}>${LETTERS(i)}</th>`).join("")}</tr><tr class="nh"><th class="rn"></th>${COLS.map((c, i) => `<th class="${c.ro ? "ro" : ""}${fzCls(i)}"${fzAttr(i)} title="${c.ro ? "Fills itself in" : ""}">${esc(c.h)}${c.ro ? " 🔒" : ""}</th>`).join("")}</tr></thead><tbody>`;
    h += `<tr class="pad"><td colspan="${COLS.length + 1}" style="height:${first * ROWH}px"></td></tr>`;
    for (let r = first; r <= last; r++) {
      if (r === rows.length) { h += `<tr class="addrow"><th class="rn">+</th><td colspan="${COLS.length}" data-r="${r}" data-c="1">${filtersOn() ? "Clear the filters to add pieces here" : "Type or paste here to add pieces…"}</td></tr>`; continue; }
      const p = rows[r];
      h += `<tr class="${p.data.active ? "act" : ""}${newIds.has(p.id) ? " new" : ""}"><th class="rn${r >= b.r0 && r <= b.r1 ? " hl" : ""}" data-r="${r}">${r + 1}</th>${COLS.map((c, ci) => cellHtml(p, ci, r)).join("")}</tr>`;
    }
    h += `<tr class="pad"><td colspan="${COLS.length + 1}" style="height:${Math.max(0, (total - 1 - last) * ROWH)}px"></td></tr></tbody>`;
    $("g").innerHTML = h;
    updateBar();
  }
  function updateBar() {
    const b = selBox();
    $("fRef").textContent = LETTERS(b.c0) + (b.r0 + 1) + (b.r0 !== b.r1 || b.c0 !== b.c1 ? ":" + LETTERS(b.c1) + (b.r1 + 1) : "");
    const p = rows[cur.r], c = COLS[cur.c];
    let v = "";
    if (p) { if (c.k === "_status") v = statusOf(p)[0]; else if (c.k === "_material") v = (mat.get(p.id) || {}).t || ""; else if (c.type === "star") v = p.data.active ? "★ Active" : ""; else v = val(p, c.k); }
    const n = (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1);
    $("fVal").innerHTML = esc(v) + (n > 1 ? ` <span class="muted">— ${fmt(n)} cells selected</span>` : "");
  }
  function renderList() {
    const max = 600, list = rows.slice(0, max);
    $("listView").innerHTML = `<div class="tablewrap"><table class="ytable ltable"><thead><tr><th>★</th><th>DH</th><th>Piece mark</th><th>Type</th><th>Size</th><th>Length</th><th>Fab shop</th><th>Fab start</th><th>Fab complete</th><th>Site need</th><th>Status</th><th>Material (from yard)</th></tr></thead><tbody>${list.map((p, r) => { const [t, k] = statusOf(p), m = mat.get(p.id) || { s: "", t: "" }; const lab = { ok: "In stock", low: "Low", out: "Out", na: "Out", done: "Done", other: "Other shop" }[m.s] || ""; return `<tr class="${p.data.active ? "act" : ""}" data-r="${r}"><td style="color:${p.data.active ? "var(--good)" : "var(--muted)"}">${p.data.active ? "★" : "☆"}</td><td>${esc(p.data.dh)}</td><td class="mono"><strong>${esc(p.data.mark)}</strong></td><td>${esc(p.data.type)}</td><td class="mono">${esc(p.data.size)}</td><td class="mono">${esc(p.data.length)}</td><td>${esc(p.data.shop)}</td><td class="muted">${shortDate(p.data.fabStart)}</td><td class="muted">${shortDate(p.data.fabComplete)}</td><td class="muted">${shortDate(p.data.siteNeed)}</td><td><span class="spill ${k}">${t}</span></td><td>${lab ? `<span class="mp ${m.s}">${lab}</span>` : ""}<div class="mdet">${esc(m.t)}</div></td></tr>`; }).join("")}</tbody></table></div>` +
      (rows.length > max ? `<div class="foot" style="padding:8px 0">Showing ${max} of ${fmt(rows.length)}. Use the filters or search to narrow it down, or switch to Spreadsheet.</div>` : !rows.length ? `<div class="empty">${loaded ? "No pieces match." : "Loading…"}</div>` : "");
  }

  // ---------- editing ----------
  const undoStack = [];
  let saveQ = new Map(), delQ = new Set(), saveT = null, saving = false;
  const newId = () => "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  function normalizeVal(k, v) {
    const c = COLS.find((x) => x.k === k); v = v == null ? "" : String(v).replace(/\r/g, "").trim();
    if (!c) return v;
    if (c.type === "star") return /^(★|\*|x|y|yes|1|true|active)$/i.test(v);
    if (c.type === "date") return v ? Y.cellDate(v) || v : "";
    if (k === "size") return v ? Y.normSize(v) : "";
    return v;
  }
  // changes: [{id, k, v}] (v already normalized)
  function applySet(changes, record = true) {
    const undo = [];
    changes.forEach(({ id, k, v }) => {
      const p = pieces.get(id); if (!p) return;
      const old = p.data[k] == null ? (k === "active" ? false : "") : p.data[k];
      if (old === v) return;
      undo.push({ id, k, v: old });
      p.data[k] = v; queueSave(p, { [k]: v });
    });
    if (record && undo.length) undoStack.push({ t: "set", ch: undo });
    return undo.length;
  }
  function addPieces(list, record = true) {
    list.forEach((p) => { pieces.set(p.id, p); queueSave(p, { ...p.data }, true); newIds.add(p.id); });
    clearTimeout(addPieces._t); addPieces._t = setTimeout(() => { newIds = new Set(); if (!editor) renderGridOrList(); }, 12000);
    if (record && list.length) undoStack.push({ t: "add", ids: list.map((p) => p.id) });
  }
  function deletePieces(ids, record = true) {
    const gone = ids.map((id) => pieces.get(id)).filter(Boolean).map((p) => ({ id: p.id, project: p.project, sort: p.sort, data: { ...p.data } }));
    gone.forEach((p) => { pieces.delete(p.id); saveQ.delete(p.id); delQ.add(p.id); });
    if (record && gone.length) undoStack.push({ t: "del", rows: gone });
    scheduleSave();
  }
  function undo() {
    const u = undoStack.pop(); if (!u) { toast("Nothing to undo."); return; }
    if (u.t === "set") applySet(u.ch, false);
    else if (u.t === "add") deletePieces(u.ids, false);
    else if (u.t === "del") { u.rows.forEach((r) => delQ.delete(r.id)); addPieces(u.rows.map((r) => ({ ...r, data: { ...r.data } })), false); }
    else if (u.t === "multi") u.list.reverse().forEach((x) => { undoStack.push(x); undo(); });
    $("pasteBox").hidden = true; afterChange();
  }
  function queueSave(p, patch, created) {
    const q = saveQ.get(p.id) || { id: p.id, project: p.project, sort: p.sort, patch: {} };
    q.project = p.project; q.sort = p.sort; Object.assign(q.patch, patch); if (created) q.created = true;
    saveQ.set(p.id, q); scheduleSave();
  }
  function scheduleSave() { setSave("busy", "Saving…"); clearTimeout(saveT); saveT = setTimeout(flush, 700); }
  function setSave(k, t) { const e = $("saveState"); e.className = "save " + k; e.textContent = t; }
  async function flush() {
    if (saving) { scheduleSave(); return; }
    if (!saveQ.size && !delQ.size) { setSave("", "All changes saved"); return; }
    saving = true;
    const ups = [...saveQ.values()], dels = [...delQ];
    saveQ = new Map(); delQ = new Set();
    try {
      await withCode(async (code) => {
        for (let i = 0; i < ups.length; i += 400) await rest("/rest/v1/rpc/save_fab_pieces", { method: "POST", body: JSON.stringify({ p_code: code, p_rows: ups.slice(i, i + 400).map((u) => ({ id: u.id, project: u.project, sort: u.sort, patch: u.patch })) }) });
        for (let i = 0; i < dels.length; i += 400) await rest("/rest/v1/rpc/delete_fab_pieces", { method: "POST", body: JSON.stringify({ p_code: code, p_ids: dels.slice(i, i + 400) }) });
      });
      lastLocalSave = Date.now();
      setSave("", "All changes saved");
    } catch (e) {
      ups.forEach((u) => { const q = saveQ.get(u.id); if (q) { Object.assign(u.patch, q.patch); } saveQ.set(u.id, u); });
      dels.forEach((d) => delQ.add(d));
      if (e.code === "cancelled") setSave("err", "Not saved – needs the team passcode (click to retry)");
      else if (e.status === 404 || /fab_pieces|schema cache/i.test(e.message || "")) setSave("err", "Not saved – run add-fab-tracker.sql in Supabase first");
      else { setSave("err", "Not saved – connection problem, retrying…"); setTimeout(scheduleSave, 8000); }
    } finally { saving = false; }
  }
  let recalcT = null;
  function afterChange() { clearTimeout(recalcT); renderGridOrList(); recalcT = setTimeout(() => { computeMaterial(); renderAll(); }, 250); }
  function renderGridOrList() { rebuildProjects(); computeRows(); if (view === "grid") renderGrid(); else renderList(); }

  // ---------- grid interaction ----------
  const sc = $("gscroll");
  let dragging = false, editor = null;
  sc.addEventListener("scroll", () => { if (editor) commitEdit(); renderGrid(); });
  sc.addEventListener("mousedown", (e) => {
    if (e.button === 2) { const td = e.target.closest("td[data-r]"); if (td) { const r = +td.dataset.r, c = +td.dataset.c, b = selBox(); if (!(r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1)) { sel = { r0: r, c0: c, r1: r, c1: c }; cur = { r, c }; renderGrid(); } } return; }
    const rn = e.target.closest("th.rn[data-r]");
    if (rn) { const r = +rn.dataset.r; if (e.shiftKey) { sel.r1 = r; sel.c0 = 0; sel.c1 = COLS.length - 1; } else { sel = { r0: r, r1: r, c0: 0, c1: COLS.length - 1 }; cur = { r, c: 1 }; } dragging = "rows"; renderGrid(); sc.focus(); e.preventDefault(); return; }
    const td = e.target.closest("td[data-r]"); if (!td) return;
    if (editor) commitEdit();
    const r = +td.dataset.r, c = +td.dataset.c;
    if (COLS[c] && COLS[c].type === "star" && !e.shiftKey && rows[r]) { const p = rows[r]; applySet([{ id: p.id, k: "active", v: !p.data.active }]); sel = { r0: r, r1: r, c0: c, c1: c }; cur = { r, c }; afterChange(); e.preventDefault(); return; }
    if (e.shiftKey) { sel.r1 = r; sel.c1 = c; } else { sel = { r0: r, c0: c, r1: r, c1: c }; cur = { r, c }; }
    dragging = "cells"; renderGrid(); sc.focus(); e.preventDefault();
  });
  sc.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    if (dragging === "rows") { const rn = e.target.closest("th.rn[data-r]"); if (rn) { sel.r1 = +rn.dataset.r; renderGrid(); } return; }
    const td = e.target.closest("td[data-r]"); if (!td) return;
    const r = +td.dataset.r, c = +td.dataset.c; if (r === sel.r1 && c === sel.c1) return; sel.r1 = r; sel.c1 = c; renderGrid();
  });
  document.addEventListener("mouseup", () => { dragging = false; });
  sc.addEventListener("dblclick", (e) => { const td = e.target.closest("td[data-r]"); if (td && COLS[+td.dataset.c].type !== "star") startEdit(null); });
  sc.addEventListener("contextmenu", (e) => { if (!e.target.closest("td[data-r], th.rn")) return; e.preventDefault(); const m = $("ctx"); m.hidden = false; m.style.left = Math.min(e.clientX, innerWidth - 220) + "px"; m.style.top = Math.min(e.clientY, innerHeight - 280) + "px"; });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest("#ctx")) $("ctx").hidden = true; });
  $("ctx").addEventListener("click", (e) => { const a = e.target.closest("[data-a]"); if (!a) return; $("ctx").hidden = true; ctxAction(a.dataset.a); sc.focus(); });

  function moveTo(r, c, extend) {
    r = Math.max(0, Math.min(rows.length, r)); c = Math.max(0, Math.min(COLS.length - 1, c));
    if (extend) { sel.r1 = r; sel.c1 = c; } else { sel = { r0: r, c0: c, r1: r, c1: c }; }
    cur = extend ? cur : { r, c };
    // keep it in view
    const top = (extend ? sel.r1 : r) * ROWH, hdr = 45;
    if (top < sc.scrollTop) sc.scrollTop = top; else if (top + ROWH + hdr > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + ROWH + hdr - sc.clientHeight;
    const colLeft = 44 + COLS.slice(0, extend ? sel.c1 : c).reduce((s, x) => s + x.w, 0), cw = COLS[extend ? sel.c1 : c].w;
    const fzW = frozenOn() ? fzLeft(FROZEN) : 44;
    if ((extend ? sel.c1 : c) >= FROZEN && colLeft < sc.scrollLeft + fzW) sc.scrollLeft = colLeft - fzW; else if (colLeft + cw > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = colLeft + cw - sc.clientWidth;
    renderGrid();
  }
  sc.addEventListener("keydown", (e) => {
    if (editor) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === "z" || k === "Z")) { e.preventDefault(); undo(); return; }
    if (ctrl && (k === "d" || k === "D")) { e.preventDefault(); fillDown(); return; }
    if (ctrl && (k === "a" || k === "A")) { e.preventDefault(); sel = { r0: 0, c0: 0, r1: Math.max(0, rows.length - 1), c1: COLS.length - 1 }; renderGrid(); return; }
    if (ctrl) return; // let copy / paste / cut events through
    const ext = e.shiftKey;
    const pos = ext ? { r: sel.r1, c: sel.c1 } : cur;
    if (k === "ArrowDown") { e.preventDefault(); moveTo(pos.r + 1, pos.c, ext); }
    else if (k === "ArrowUp") { e.preventDefault(); moveTo(pos.r - 1, pos.c, ext); }
    else if (k === "ArrowRight") { e.preventDefault(); moveTo(pos.r, pos.c + 1, ext); }
    else if (k === "ArrowLeft") { e.preventDefault(); moveTo(pos.r, pos.c - 1, ext); }
    else if (k === "PageDown") { e.preventDefault(); moveTo(pos.r + 20, pos.c, ext); }
    else if (k === "PageUp") { e.preventDefault(); moveTo(pos.r - 20, pos.c, ext); }
    else if (k === "Home") { e.preventDefault(); moveTo(pos.r, 1, ext); }
    else if (k === "Tab") { e.preventDefault(); moveTo(cur.r, cur.c + (e.shiftKey ? -1 : 1), false); }
    else if (k === "Enter") { e.preventDefault(); moveTo(cur.r + (e.shiftKey ? -1 : 1), cur.c, false); }
    else if (k === "F2") { e.preventDefault(); startEdit(null); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); clearSel(); }
    else if (k === " " && COLS[cur.c].type === "star") { e.preventDefault(); toggleStar(); }
    else if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(k); }
  });
  function startEdit(initial) {
    const c = COLS[cur.c]; if (!c || c.ro) { toast(c && c.ro ? "This column fills itself in." : ""); return; }
    if (c.type === "star") { toggleStar(); return; }
    let p = rows[cur.r];
    if (!p) { if (filtersOn()) { toast("Clear the filters to add pieces."); return; } p = null; }
    const td = sc.querySelector(`td[data-r="${cur.r}"][data-c="${cur.c}"]`) || sc.querySelector(`td[data-r="${cur.r}"]`); if (!td) return;
    const rect = td.getBoundingClientRect(), box = sc.getBoundingClientRect();
    const xOff = td.colSpan > 1 ? COLS.slice(1, cur.c).reduce((a, x) => a + x.w, 0) : 0;
    const inp = document.createElement("input");
    inp.className = "cedit"; if (c.list) inp.setAttribute("list", "dl-" + c.list);
    inp.style.left = rect.left - box.left + sc.scrollLeft + xOff + "px"; inp.style.top = rect.top - box.top + sc.scrollTop + "px";
    inp.style.width = Math.max(c.w, 120) + "px"; inp.style.height = rect.height + "px";
    const curVal = p ? (c.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(val(p, c.k)) ? shortDate(val(p, c.k)) : val(p, c.k)) : "";
    inp.value = initial != null ? initial : curVal;
    sc.appendChild(inp); inp.focus(); if (initial == null) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
    editor = { inp, r: cur.r, c: cur.c };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation(); // the grid below must not see these keys too
      if (e.key === "Enter") { e.preventDefault(); commitEdit(); moveTo(cur.r + (e.shiftKey ? -1 : 1), cur.c, false); sc.focus(); }
      else if (e.key === "Tab") { e.preventDefault(); commitEdit(); moveTo(cur.r, cur.c + (e.shiftKey ? -1 : 1), false); sc.focus(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); sc.focus(); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !inp.getAttribute("list")) { e.preventDefault(); commitEdit(); moveTo(cur.r + (e.key === "ArrowDown" ? 1 : -1), cur.c, false); sc.focus(); }
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (editor && editor.inp === inp) commitEdit(); }, 0));
  }
  function cancelEdit() { if (!editor) return; editor.inp.remove(); editor = null; }
  function commitEdit() {
    if (!editor) return;
    const { inp, r, c } = editor; editor = null; const raw = inp.value; inp.remove();
    const k = COLS[c].k, v = normalizeVal(k, raw);
    if (r >= rows.length) { if (!String(raw).trim()) return; const p = newPiece(0); p.data[k] = v; addPieces([p]); }
    else applySet([{ id: rows[r].id, k, v }]);
    afterChange();
  }
  function newPiece(offset) {
    const list = projPieces(curProj); const maxSort = list.length ? list[list.length - 1].sort : 0;
    return { id: newId(), project: curProj, sort: maxSort + 1000 + offset * 1000, data: {} };
  }
  function toggleStar() { const b = selBox(); const ps = rows.slice(b.r0, b.r1 + 1); if (!ps.length) return; const on = !ps.every((p) => p.data.active); applySet(ps.map((p) => ({ id: p.id, k: "active", v: on }))); afterChange(); }
  function clearSel() {
    const b = selBox(), ch = [];
    for (let r = b.r0; r <= b.r1 && r < rows.length; r++) for (let c = b.c0; c <= b.c1; c++) { const col = COLS[c]; if (col.ro) continue; ch.push({ id: rows[r].id, k: col.k, v: col.type === "star" ? false : "" }); }
    if (applySet(ch)) afterChange();
  }
  function fillDown() {
    const b = selBox(); if (b.r1 <= b.r0) { toast("Select the cell to copy and the cells below it, then Ctrl+D."); return; }
    const src = rows[b.r0]; if (!src) return; const ch = [];
    for (let r = b.r0 + 1; r <= b.r1 && r < rows.length; r++) for (let c = b.c0; c <= b.c1; c++) { const col = COLS[c]; if (col.ro) continue; ch.push({ id: rows[r].id, k: col.k, v: src.data[col.k] == null ? (col.type === "star" ? false : "") : src.data[col.k] }); }
    if (applySet(ch)) { afterChange(); toast("Filled down."); }
  }
  // copy: tab-separated, like Excel
  function selText() {
    const b = selBox(), out = [];
    for (let r = b.r0; r <= b.r1 && r < rows.length; r++) {
      const p = rows[r], line = [];
      for (let c = b.c0; c <= b.c1; c++) { const col = COLS[c]; let v; if (col.k === "_status") v = statusOf(p)[0]; else if (col.k === "_material") v = (mat.get(p.id) || {}).t || ""; else if (col.type === "star") v = p.data.active ? "★" : ""; else if (col.type === "date") v = shortDate(val(p, col.k)) || val(p, col.k); else v = val(p, col.k); line.push(String(v).replace(/[\t\n]/g, " ")); }
      out.push(line.join("\t"));
    }
    return out.join("\r\n");
  }
  document.addEventListener("copy", (e) => { if (document.activeElement !== sc || view !== "grid") return; e.preventDefault(); e.clipboardData.setData("text/plain", selText()); toast("Copied " + fmt((selBox().r1 - selBox().r0 + 1)) + " row(s)."); });
  document.addEventListener("cut", (e) => { if (document.activeElement !== sc || view !== "grid") return; e.preventDefault(); e.clipboardData.setData("text/plain", selText()); clearSel(); });
  document.addEventListener("paste", (e) => {
    if (view !== "grid" || editor) return;
    if (document.activeElement !== sc && !sc.contains(document.activeElement)) return;
    const text = (e.clipboardData || window.clipboardData).getData("text/plain"); if (!text) return;
    e.preventDefault(); pasteText(text);
  });
  function parseTSV(text) {
    const out = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"' && f === "") q = true;
      else if (ch === "\t") { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); out.push(row); row = []; f = ""; }
      else f += ch;
    }
    if (f !== "" || row.length) { row.push(f); out.push(row); }
    while (out.length && out[out.length - 1].every((x) => x === "")) out.pop();
    return out;
  }
  function pasteText(text) {
    if (!curProj) { toast("Add a project first (+ Project)."); return; }
    let data = parseTSV(text); if (!data.length) return;
    const b = selBox();
    // header row pasted too? line the columns up by name
    let map = null;
    const hdrKeys = data[0].map(colFromHeader);
    if (hdrKeys.filter(Boolean).length >= 3 && hdrKeys.includes("mark")) {
      if (filtersOn()) { toast("Clear the filters before pasting a sheet with headers."); return; }
      const before = undoStack.length;
      const res = mergeRecords(curProj, hdrKeys, data.slice(1));
      const steps = undoStack.splice(before); if (steps.length) undoStack.push({ t: "multi", list: steps });
      showPasteBox(data.length - 1, hdrKeys.length, res.nNew, res.nUpd, 0, 0, true);
      afterChange(); return;
    }
    const startR = map ? (rows.length && b.r0 < rows.length && !isBlankRow(rows[b.r0]) ? rows.length : Math.min(b.r0, rows.length)) : b.r0;
    // a single value pasted onto a bigger selection fills it
    if (!map && data.length === 1 && data[0].length === 1 && (b.r1 > b.r0 || b.c1 > b.c0)) { const fill = []; for (let r = b.r0; r <= b.r1; r++) fill.push(Array(b.c1 - b.c0 + 1).fill(data[0][0])); data = fill; }
    const needNew = startR + data.length - rows.length;
    if (needNew > 0 && filtersOn()) { toast("Clear the filters before pasting new pieces."); return; }
    const ch = [], created = []; let skippedRo = 0, badDates = 0, updatedIds = new Set();
    data.forEach((line, i) => {
      const r = startR + i; let p = rows[r];
      if (!p) { p = newPiece(created.length); created.push(p); }
      line.forEach((cellv, j) => {
        let k;
        if (map) k = map[j]; else { const col = COLS[b.c0 + j]; if (!col) return; if (col.ro) { if (String(cellv).trim()) skippedRo++; return; } k = col.k; }
        if (!k) return;
        const v = normalizeVal(k, cellv);
        if (COLS.find((c) => c.k === k).type === "date" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) badDates++;
        if (created.includes(p)) { if (v !== "" && v !== false) p.data[k] = v; }
        else { ch.push({ id: p.id, k, v }); updatedIds.add(p.id); }
      });
    });
    const realNew = created.filter((p) => Object.keys(p.data).length);
    const before = undoStack.length;
    const n = applySet(ch);
    addPieces(realNew);
    // one undo step for the whole paste
    const steps = undoStack.splice(before); if (steps.length) undoStack.push({ t: "multi", list: steps });
    const cols = Math.max(...data.map((l) => l.length));
    sel = { r0: startR, c0: map ? 0 : b.c0, r1: startR + data.length - 1, c1: map ? COLS.length - 1 : b.c0 + cols - 1 }; cur = { r: startR, c: sel.c0 };
    showPasteBox(data.length, cols, realNew.length, n ? updatedIds.size : 0, badDates, skippedRo, !!map);
    afterChange();
  }
  const isBlankRow = (p) => !Object.values(p.data).some((v) => v && v !== true);
  function showPasteBox(nr, nc, nNew, nUpd, bad, ro, mapped) {
    const box = $("pasteBox"); box.hidden = false;
    box.innerHTML = `<strong>✔ Pasted ${fmt(nr)} row${nr === 1 ? "" : "s"} × ${nc} column${nc === 1 ? "" : "s"}${mapped ? " (lined up by header names)" : ""}</strong><span>${nNew ? `<span class="tag">${fmt(nNew)} new piece${nNew === 1 ? "" : "s"}</span>` : ""}${nUpd ? `<span class="tag">${fmt(nUpd)} updated</span>` : ""}${bad ? `<span class="tag" title="Underlined in the sheet">${bad} date${bad === 1 ? "" : "s"} not understood</span>` : ""}${ro ? `<span class="tag">${ro} Status/Material cells skipped (they fill themselves in)</span>` : ""}</span><span style="margin-left:auto">Material re-checked against the yard · <a href="#" id="undoPaste">Undo paste</a> · <a href="#" id="hidePaste">Hide</a></span>`;
  }
  function ctxAction(a) {
    const b = selBox();
    if (a === "copy") { navigator.clipboard && navigator.clipboard.writeText(selText()).then(() => toast("Copied."), () => toast("Use Ctrl+C to copy.")); return; }
    if (a === "clear") { clearSel(); return; }
    if (a === "star") { toggleStar(); return; }
    if (filtersOn() && a !== "del") { toast("Clear the filters to insert rows."); return; }
    if (a === "del") {
      const ids = rows.slice(b.r0, b.r1 + 1).map((p) => p.id); if (!ids.length) return;
      if (ids.length > 1 && !confirm(`Delete ${ids.length} rows? You can undo with Ctrl+Z.`)) return;
      deletePieces(ids); toast(`Deleted ${ids.length} row${ids.length === 1 ? "" : "s"} · Ctrl+Z to undo`); afterChange(); return;
    }
    const list = projPieces(curProj);
    let at, n = 1;
    if (a === "above") at = b.r0; else if (a === "below") at = b.r1 + 1; else { at = list.length; n = 10; }
    const prev = list[at - 1] ? list[at - 1].sort : (list[0] ? list[0].sort - 1000 : 0), next = list[at] ? list[at].sort : prev + 1000 * (n + 1);
    const made = []; for (let i = 0; i < n; i++) made.push({ id: newId(), project: curProj, sort: prev + ((next - prev) * (i + 1)) / (n + 1), data: { dh: (list[at] || list[at - 1] || { data: {} }).data.dh || "" } });
    addPieces(made); afterChange(); moveTo(at, 2, false);
  }

  // ---------- toolbar ----------
  document.addEventListener("click", (e) => {
    const t = e.target;
    const pb = t.closest("[data-p]"); if (pb) { curProj = pb.dataset.p; try { localStorage.setItem("xai-fab-project", curProj); } catch (er) { /* */ } sel = { r0: 0, c0: 1, r1: 0, c1: 1 }; cur = { r: 0, c: 1 }; sc.scrollTop = 0; newIds = new Set(); renderAll(); return; }
    if (t.id === "addProj") { addProject(); return; }
    const fb = t.closest("[data-f]"); if (fb) { st.f = fb.dataset.f; renderAll(); return; }
    const mb = t.closest("[data-m]"); if (mb) { st.m = st.m === mb.dataset.m ? "" : mb.dataset.m; renderAll(); return; }
    const vb = t.closest("[data-v]"); if (vb) { view = vb.dataset.v; try { localStorage.setItem("xai-fab-view", view); } catch (er) { /* */ } renderAll(); return; }
    const sb = t.closest("#side [data-size]"); if (sb) { st.size = st.size === sb.dataset.size ? "" : sb.dataset.size; renderAll(); return; }
    if (t.id === "clrSize") { e.preventDefault(); st.size = ""; renderAll(); return; }
    if (t.id === "undoPaste") { e.preventDefault(); undo(); return; }
    if (t.id === "hidePaste") { e.preventDefault(); $("pasteBox").hidden = true; return; }
    if (t.id === "saveState" && /retry/.test(t.textContent)) { scheduleSave(); return; }
    const lr = t.closest("#listView tr[data-r]"); if (lr) { view = "grid"; renderAll(); moveTo(+lr.dataset.r, 2, false); sc.focus(); return; }
  });
  $("undoBtn").onclick = () => { undo(); sc.focus(); };
  // a list of piece marks pasted from Excel arrives with line breaks, which a search box would squash together
  $("q").addEventListener("paste", (e) => { const t = (e.clipboardData || window.clipboardData).getData("text/plain"); if (!/[\r\n\t]/.test(t)) return; e.preventDefault(); const v = t.split(/[\r\n\t]+/).map((x) => x.trim()).filter(Boolean).join(", "); $("q").value = v; st.q = v; renderAll(); });
  let qT; $("q").addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => { st.q = e.target.value; renderAll(); }, 200); });
  $("exportBtn").onclick = exportXlsx;
  $("importBtn").onclick = () => { $("importFile").value = ""; $("importFile").click(); };
  $("importFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); };
  $("projBtn").onclick = projMenu;

  function dialog(html) { $("dlg").innerHTML = html; $("dlg").hidden = false; $("dlgScrim").classList.add("open"); }
  function closeDlg() { $("dlg").hidden = true; $("dlgScrim").classList.remove("open"); }
  $("dlgScrim").onclick = closeDlg;
  function addProject() {
    dialog(`<h2>New project</h2><p class="hint">For example "SPAM" or "Dry Cooler". You can paste pieces in once it's made.</p><div class="row"><input type="text" id="npName" placeholder="Project name" style="flex:1"></div><div class="actions"><button class="btn" id="npCancel">Cancel</button><button class="btn primary" id="npOk">Add project</button></div>`);
    $("npName").focus();
    const ok = () => { const n = $("npName").value.trim(); if (!n) return; if (projects.includes(n)) { toast("That project already exists."); return; } projOrder.push(n); curProj = n; try { localStorage.setItem("xai-fab-project", n); } catch (er) { /* */ } closeDlg(); renderAll(); saveProjOrder(); toast(`Project "${n}" added. Paste or type pieces into it.`); sc.focus(); };
    $("npOk").onclick = ok; $("npCancel").onclick = closeDlg; $("npName").onkeydown = (e) => { if (e.key === "Enter") ok(); };
  }
  function projMenu() {
    if (!curProj) return;
    const n = projPieces(curProj).length;
    dialog(`<h2>${esc(curProj)}</h2><div class="row"><label>Rename to <input type="text" id="rnName" value="${esc(curProj)}"></label><button class="btn" id="rnOk">Rename</button></div><hr style="border:0;border-top:1px solid var(--line)"><p class="hint">Delete this project and its ${fmt(n)} pieces. Type the project name to confirm.</p><div class="row"><input type="text" id="delName" placeholder="${esc(curProj)}"><button class="btn danger" id="delOk">Delete project</button></div><div class="actions"><button class="btn" id="pmClose">Close</button></div>`);
    $("pmClose").onclick = closeDlg;
    $("rnOk").onclick = () => {
      const nn = $("rnName").value.trim(); if (!nn || nn === curProj) return; if (projects.includes(nn)) { toast("A project with that name exists."); return; }
      const old = curProj; projPieces(old).forEach((p) => { p.project = nn; queueSave(p, {}); }); projOrder = projOrder.map((x) => (x === old ? nn : x)); curProj = nn; saveProjOrder(); closeDlg(); renderAll(); toast("Renamed.");
    };
    $("delOk").onclick = () => { if ($("delName").value.trim() !== curProj) { toast("Type the project name exactly to delete it."); return; } deletePieces(projPieces(curProj).map((p) => p.id)); projOrder = projOrder.filter((x) => x !== curProj); saveProjOrder(); closeDlg(); curProj = ""; renderAll(); toast("Project deleted · Ctrl+Z to undo"); };
  }
  async function saveProjOrder() { try { await withCode((code) => rest("/rest/v1/rpc/save_setting", { method: "POST", body: JSON.stringify({ p_code: code, p_id: "fab-projects", p_data: { order: projOrder } }) })); } catch (e) { /* not critical */ } }

  // Rows with header names (pasted with the header row, or imported from a file): pieces are matched by
  // DH + piece mark (+ how many times that pair has come up), existing ones updated, new ones added at the bottom.
  function mergeRecords(proj, keys, list) {
    const existing = new Map(), seen = new Map();
    projPieces(proj).forEach((p) => { const k = (p.data.dh || "") + "|" + (p.data.mark || ""); const n = (seen.get(k) || 0) + 1; seen.set(k, n); existing.set(k + "|" + n, p); });
    const seen2 = new Map(), ch = [], made = []; let sort = (projPieces(proj).slice(-1)[0] || { sort: 0 }).sort, nUpd = 0;
    list.forEach((r) => {
      const d = {}; keys.forEach((k, j) => { if (!k) return; const v = normalizeVal(k, r[j] instanceof Date ? Y.cellDate(r[j]) : r[j]); if (v !== "" && v !== false) d[k] = v; });
      if (!d.mark) return;
      const key = (d.dh || "") + "|" + d.mark; const n = (seen2.get(key) || 0) + 1; seen2.set(key, n);
      const p = existing.get(key + "|" + n);
      if (p) { Object.entries(d).forEach(([k, v]) => ch.push({ id: p.id, k, v })); nUpd++; }
      else { sort += 1000; made.push({ id: newId(), project: proj, sort, data: d }); }
    });
    applySet(ch); addPieces(made);
    return { nNew: made.length, nUpd };
  }

  // ---------- import from an Excel file ----------
  async function importFile(file) {
    if (!window.XLSX) { toast("Excel reader didn't load. Check your connection."); return; }
    let wb; try { wb = XLSX.read(await file.arrayBuffer(), { cellDates: true }); } catch (e) { toast("Couldn't read that file."); return; }
    const sheets = [];
    wb.SheetNames.forEach((name) => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
      for (let h = 0; h < Math.min(aoa.length, 25); h++) {
        const keys = aoa[h].map(colFromHeader);
        if (keys.includes("mark") && keys.includes("size")) {
          const list = aoa.slice(h + 1).filter((r) => String(r[keys.indexOf("mark")] || "").trim() && !/\(example\)/i.test(String(r[keys.indexOf("mark")])));
          sheets.push({ name, keys, list }); break;
        }
      }
    });
    if (!sheets.length) { toast("Couldn't find Piece mark and Size columns in that file.", 5000); return; }
    const opts = sheets.map((s, i) => `<label class="row" style="margin:4px 0"><input type="checkbox" data-sh="${i}" checked> <strong>${esc(s.name)}</strong> – ${fmt(s.list.length)} pieces → project <input type="text" data-pj="${i}" value="${esc(projects.includes(s.name) ? s.name : sheets.length === 1 && curProj ? curProj : s.name)}" style="width:160px"></label>`).join("");
    const retire = [...feeds.values()].filter((f) => Number(f.v) >= 2 && !f.retired && (f.rows || []).length);
    dialog(`<h2>Import from Excel</h2><p class="hint">${esc(file.name)} · pieces are matched by DH + piece mark: existing ones are updated, new ones are added. Nothing is deleted.</p>${opts}${retire.length ? `<label class="row" style="margin-top:10px"><input type="checkbox" id="retire" checked> Stop counting what the Excel tracker last sent (${retire.map((f) => esc(f.sheet)).join(", ")}) – these pieces now live here, so they'd be counted twice</label>` : ""}<div class="actions"><button class="btn" id="imCancel">Cancel</button><button class="btn primary" id="imOk">Import</button></div>`);
    $("imCancel").onclick = closeDlg;
    $("imOk").onclick = async () => {
      let nNew = 0, nUpd = 0; const before = undoStack.length;
      sheets.forEach((s, i) => {
        if (!document.querySelector(`[data-sh="${i}"]`).checked) return;
        const proj = document.querySelector(`[data-pj="${i}"]`).value.trim() || s.name;
        if (!projOrder.includes(proj)) projOrder.push(proj);
        const res = mergeRecords(proj, s.keys, s.list); nNew += res.nNew; nUpd += res.nUpd;
        if (s === sheets[0]) curProj = proj;
      });
      const steps = undoStack.splice(before); if (steps.length) undoStack.push({ t: "multi", list: steps });
      const doRetire = $("retire") && $("retire").checked;
      closeDlg(); saveProjOrder(); renderAll(); afterChange();
      toast(`Imported: ${fmt(nNew)} new, ${fmt(nUpd)} updated.`, 4000);
      if (doRetire) { try { await withCode(async (code) => { for (const [sk, f] of feeds) if (Number(f.v) >= 2 && !f.retired) await rest("/rest/v1/rpc/save_setting", { method: "POST", body: JSON.stringify({ p_code: code, p_id: "fab-feed-" + sk, p_data: { ...f, rows: [], retired: true, retiredAt: new Date().toISOString() } }) }); }); await refresh(true); } catch (e) { /* will retry next time */ } }
    };
  }

  // ---------- export ----------
  function exportXlsx() {
    if (!window.XLSX) { toast("Excel export didn't load. Check your connection."); return; }
    const wb = XLSX.utils.book_new();
    projects.forEach((proj) => {
      const head = COLS.map((c) => (c.k === "active" ? "Active" : c.h));
      const data = [head].concat(projPieces(proj).map((p) => COLS.map((c) => { if (c.k === "_status") return statusOf(p)[0]; if (c.k === "_material") return (mat.get(p.id) || {}).t || ""; if (c.type === "star") return p.data.active ? "★" : ""; if (c.type === "date") { const d = val(p, c.k); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : d; } return val(p, c.k); })));
      const ws = XLSX.utils.aoa_to_sheet(data, { cellDates: true });
      ws["!cols"] = COLS.map((c) => ({ wch: Math.round(c.w / 7) }));
      for (let r = 1; r < data.length; r++) COLS.forEach((c, j) => { if (c.type === "date") { const cell = ws[XLSX.utils.encode_cell({ r, c: j })]; if (cell && cell.t === "d") cell.z = "m/d/yy"; } });
      XLSX.utils.book_append_sheet(wb, ws, proj.slice(0, 31).replace(/[\\\/?*\[\]:]/g, "-"));
    });
    const sh = [["Size", "Pieces lacking material", "Why"]].concat([...shortBy.entries()].map(([s, v]) => [s, v.n, [...v.why.entries()].map(([w, n]) => `${w} (${n})`).join(", ")]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh), "Short by size");
    XLSX.writeFile(wb, `fab-tracker-${Y.todayIso()}.xlsx`);
  }

  // ---------- Supabase ----------
  const CFG = window.TRACKER_CONFIG || {};
  const API = String(CFG.supabaseUrl || "").replace(/\/+$/, ""), KEY = CFG.supabaseAnonKey || "";
  const PC_KEY = "xai-tracker-passcode";
  let sessionCode = ""; try { sessionCode = localStorage.getItem(PC_KEY) || ""; } catch (e) { /* storage blocked */ }
  const storeCode = (c) => { try { c ? localStorage.setItem(PC_KEY, c) : localStorage.removeItem(PC_KEY); } catch (e) { /* storage blocked */ } };
  async function rest(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { apikey: KEY, ...(/^eyJ/.test(KEY) ? { Authorization: "Bearer " + KEY } : {}), "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (!res.ok) { let msg = ""; try { msg = (await res.json()).message || ""; } catch (e) { /* no body */ } const err = new Error(msg || res.statusText); err.code = /wrong passcode/i.test(msg) ? "bad_passcode" : "server"; err.status = res.status; throw err; }
    const t = await res.text(); return t ? JSON.parse(t) : null;
  }
  async function restAll(path) { // the database hands out 1,000 rows at a time
    let out = [];
    for (let off = 0; off < 200000; off += 1000) { const part = await rest(path + (path.includes("?") ? "&" : "?") + "limit=1000&offset=" + off); out = out.concat(part || []); if (!part || part.length < 1000) break; }
    return out;
  }
  function askPasscode(wrong) {
    return new Promise((resolve) => {
      const dlg = $("pcDlg"), inp = $("pcInput");
      $("pcErr").textContent = wrong ? "That passcode didn't work. Check with your team lead." : "";
      dlg.hidden = false; $("pcScrim").classList.add("open"); inp.value = ""; setTimeout(() => inp.focus(), 30);
      const done = (v) => { dlg.hidden = true; $("pcScrim").classList.remove("open"); $("pcOk").onclick = $("pcCancel").onclick = inp.onkeydown = null; resolve(v); };
      $("pcOk").onclick = () => done(inp.value.trim());
      $("pcCancel").onclick = () => done(null);
      inp.onkeydown = (e) => { if (e.key === "Enter") done(inp.value.trim()); if (e.key === "Escape") done(null); };
    });
  }
  async function withCode(fn) {
    let wrong = false;
    for (let tries = 0; tries < 4; tries++) {
      if (!sessionCode) { const c = await askPasscode(wrong); if (!c) { const e = new Error("cancelled"); e.code = "cancelled"; throw e; } sessionCode = c; }
      try { const r = await fn(sessionCode); storeCode(sessionCode); return r; }
      catch (e) { if (e.code === "bad_passcode") { sessionCode = ""; storeCode(""); wrong = true; continue; } throw e; }
    }
    const e = new Error("cancelled"); e.code = "cancelled"; throw e;
  }
  function setSync(ok, text) { $("syncDot").className = "dot" + (ok ? " live" : " err"); $("syncText").textContent = text; }
  let lastLocalSave = 0, tableMissing = false;
  async function refresh(full) {
    try {
      const [rs, fs] = await Promise.all([
        restAll("/rest/v1/raw_steel?select=id,item_type,size,length,qty&order=id"),
        rest("/rest/v1/app_settings?select=id,data&or=(id.like.fab-feed-*,id.eq.fab-projects)"),
      ]);
      storedRows = (rs || []).map((x) => ({ ...x, item_type: x.item_type || "steel", length: x.length || "" }));
      const m = new Map();
      (fs || []).forEach((x) => { if (x.id === "fab-projects") { const o = (x.data && x.data.order) || []; o.forEach((n) => { if (!projOrder.includes(n)) projOrder.push(n); }); } else if (x.data && x.data.sheet) m.set(x.id.slice(9), x.data); });
      feeds = m;
      let fp = null;
      try { fp = await restAll("/rest/v1/fab_pieces?select=id,project,sort,data&order=project,sort"); tableMissing = false; }
      catch (e) { if (e.status === 404 || /fab_pieces|schema cache/i.test(e.message || "")) tableMissing = true; else throw e; }
      if (fp) {
        // keep anything typed here that hasn't been saved yet
        const pending = new Map([...saveQ.values()].map((q) => [q.id, q]));
        const incoming = new Map(fp.map((r) => [r.id, { id: r.id, project: r.project, sort: Number(r.sort), data: r.data || {} }]));
        if (Date.now() - lastLocalSave > 1500 || full) {
          pieces.forEach((p, id) => { if (!incoming.has(id) && !pending.has(id) && !delQ.has(id)) pieces.delete(id); });
          incoming.forEach((p, id) => { if (delQ.has(id)) return; const q = pending.get(id); if (q) Object.assign(p.data, q.patch); if (editor && rows[editor.r] && rows[editor.r].id === id) return; pieces.set(id, p); });
        }
      }
      loaded = true;
      setSync(!tableMissing, tableMissing ? "Setup needed: run add-fab-tracker.sql in Supabase" : "Live · refreshes every 20 seconds");
    } catch (e) { loaded = true; setSync(false, "Offline · retrying"); }
    computeMaterial();
    if (!editor && !dragging) renderAll();
  }

  window.addEventListener("beforeunload", (e) => { if (saveQ.size || delQ.size) { flush(); e.preventDefault(); e.returnValue = ""; } });
  renderAll();
  if (!API || !KEY) setSync(false, "Not connected (config.js)");
  else { refresh(true); setInterval(() => { if (!document.hidden && !saveQ.size && !saving) refresh(false); }, 20000); }
  setTimeout(() => sc.focus(), 300);
})();
