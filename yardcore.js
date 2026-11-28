// Shared steel helpers for the Fab Tracker page: sizes, lengths, the cutting rules and the yard math.
// (The Yard Inventory page has the same rules built in; keep the two in step.)
(function () {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const todayIso = () => isoOf(new Date());
  const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

  function normSize(s) {
    s = String(s || "").trim().replace(/\s+/g, "").replace(/#/g, "").replace(/["”]/g, "");
    const m = s.match(/^([A-Za-z]*)(\d+(?:\.\d+)?)[xX×](\d+(?:\.\d+)?)$/);
    if (m) return (m[1] ? m[1].toUpperCase() : "W") + m[2] + "x" + m[3];
    return s.toUpperCase().replace(/X/g, "x");
  }
  function lbPerFt(size) { const m = String(size).match(/^(?:W|S|M|HP)\d+(?:\.\d+)?x(\d+(?:\.\d+)?)$/); return m ? Number(m[1]) : null; }
  // 40'  ·  23'-4"  ·  32'-8 7/16"  ·  9'-10 13/16"
  function feetOf(len) {
    const s = String(len || "").trim().replace(/’/g, "'").replace(/”/g, '"'); if (!s) return null;
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:-?\s*(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?\s*(?:"|in)?)?$/i);
    if (!m) return null; return Number(m[1]) + ((m[2] ? Number(m[2]) : 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0)) / 12;
  }
  function normLen(len) {
    const s = String(len || "").trim(); if (!s) return "";
    if (/^\d+(\.\d+)?$/.test(s)) return s + "'";
    return s.replace(/\s*ft\b/i, "'");
  }
  function autoEach(size, len) { const p = lbPerFt(normSize(size)), f = feetOf(len); return p && f ? Math.round(p * f) : null; }
  function fmtFeet(ft) {
    let eighths = Math.floor(ft * 12 * 8 + 1e-6); const f = Math.floor(eighths / 96); eighths -= f * 96;
    const inch = Math.floor(eighths / 8), e = eighths % 8;
    const frac = e ? { 1: "1/8", 2: "1/4", 3: "3/8", 4: "1/2", 5: "5/8", 6: "3/4", 7: "7/8" }[e] : "";
    return !inch && !frac ? f + "'" : `${f}'-${inch}${frac ? " " + frac : ""}"`;
  }
  const sizeSort = (a, b) => { const pa = String(a).match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/), pb = String(b).match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/); if (pa && pb && String(a)[0] === String(b)[0]) return Number(pb[1]) - Number(pa[1]) || Number(pb[2]) - Number(pa[2]); return String(a).localeCompare(String(b)); };
  // Any date the team might type or paste → yyyy-mm-dd ("" if it isn't one)
  function cellDate(v) {
    if (v instanceof Date && !isNaN(v)) return isoOf(new Date(v.getTime() + 12 * 3600e3));
    if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5) + 12 * 3600e3); return d.toISOString().slice(0, 10); }
    const s = String(v || "").trim(); if (!s) return "";
    if (/^\d{5}$/.test(s) && Number(s) > 20000 && Number(s) < 80000) return cellDate(Number(s));
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/); if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return y + "-" + pad(m[1]) + "-" + pad(m[2]); }
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/); if (m) return new Date().getFullYear() + "-" + pad(m[1]) + "-" + pad(m[2]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    if (/^today$/i.test(s)) return todayIso();
    return "";
  }
  const isLakeview = (shop) => /lake\s*-?\s*view/i.test(String(shop || ""));
  const FAB_START = "2026-11-22";
  const DROP_MIN_FT = 5, KERF_FT = 0.125 / 12;

  // Cutting: hand out bars/drops to pieces, oldest first, the same way the Yard Inventory page does.
  // base: raw_steel rows {item_type,size,length,qty,id}. Returns the inventory left and which bar each piece used.
  function makeYard(base) {
    const isFabLine = (r) => String(r.id || "").startsWith("fab-");
    const inv = new Map(), std = new Map(), stocked = new Set();
    const invOf = (s) => { if (!inv.has(s)) inv.set(s, new Map()); return inv.get(s); };
    base.filter((r) => (r.item_type || "steel") === "steel").forEach((r) => {
      const s = normSize(r.size), m = invOf(s); m.set(r.length || "", (m.get(r.length || "") || 0) + Number(r.qty || 0));
      if (!isFabLine(r) && Number(r.qty) > 0) { stocked.add(s); if (r.length) { if (!std.has(s)) std.set(s, new Set()); std.get(s).add(r.length); } }
    });
    // force=true: the piece is already cut, so take a bar even if the yard is short (like the app does)
    function take(size, lenTxt, rawTxt, force) {
      const m = invOf(size), need = feetOf(lenTxt);
      const given = rawTxt && feetOf(normLen(rawTxt)) != null ? normLen(rawTxt) : "";
      let stock = given;
      if (!stock) {
        const fits = [...m.entries()].filter(([l, q]) => q > 0 && l && feetOf(l) != null && (need == null || feetOf(l) >= need - 1e-9)).sort((a, b) => feetOf(a[0]) - feetOf(b[0]));
        if (fits.length) stock = fits[0][0];
        else if (!force) return null;
        else {
          const known = [...(std.get(size) || [])].filter((l) => need == null || (feetOf(l) || 0) >= need).sort((a, b) => feetOf(a) - feetOf(b));
          stock = known[0] || [...m.keys()].filter(Boolean).sort((a, b) => (feetOf(b) || 0) - (feetOf(a) || 0))[0] || "";
        }
      }
      m.set(stock, (m.get(stock) || 0) - 1);
      const sf = feetOf(stock); let drop = "";
      if (need != null && sf != null) { const rem = sf - need - KERF_FT; if (rem >= DROP_MIN_FT - 1e-9) { drop = fmtFeet(rem); m.set(drop, (m.get(drop) || 0) + 1); } }
      return { stock, isStd: (std.get(size) || new Set()).has(stock), drop };
    }
    function leftFor(size, lenTxt) { const need = feetOf(lenTxt); let n = 0; invOf(size).forEach((q, l) => { const f = feetOf(l); if (q > 0 && f != null && (need == null || f >= need - 1e-9)) n += q; }); return n; }
    function longest(size) { let b = null; invOf(size).forEach((q, l) => { const f = feetOf(l); if (q > 0 && f != null && (!b || f > b[0])) b = [f, l]; }); return b ? b[1] : ""; }
    return { inv, stocked, take, leftFor, longest };
  }

  window.YC = { pad, isoOf, todayIso, slug, normSize, normLen, feetOf, autoEach, fmtFeet, sizeSort, cellDate, isLakeview, FAB_START, makeYard };
})();
