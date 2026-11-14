/* Shared helpers for the UK Fuel Map: CSV parsing, Fuel Finder CSV -> stations.json,
   and reading the UK Fuels list. Works in the browser and in Node (for testing). */
(function (root) {
  "use strict";

  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    text = String(text).replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some(c => c.trim() !== "")) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell); if (row.some(c => c.trim() !== "")) rows.push(row);
    return rows;
  }

  const normPc = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const FUELS = ["E5", "E10", "B7S", "B7P", "B10", "HVO"];
  const AMENITIES = {
    "fuel_and_energy_services.adblue_pumps": "adblue_pumps",
    "fuel_and_energy_services.adblue_packaged": "adblue_packaged",
    "fuel_and_energy_services.lpg_pumps": "lpg_pumps",
    "vehicle_services.car_wash": "car_wash",
    "air_pump_or_screenwash": "air_pump_or_screenwash",
    "water_filling": "water_filling",
    "twenty_four_hour_fuel": "twenty_four_hour_fuel",
    "customer_toilets": "customer_toilets"
  };

  function toISO(s) {
    if (!s) return "";
    const d = new Date(String(s).replace(/\s*\(.*\)\s*$/, ""));
    return isNaN(d) ? "" : d.toISOString().slice(0, 16);
  }
  function price(v) {
    const p = parseFloat(v);
    if (!isFinite(p) || p <= 0) return null;
    return Math.round((p < 10 ? p * 100 : p) * 10) / 10;
  }
  const t5 = s => String(s || "").slice(0, 5);

  /* Fuel Finder "UpdatedFuelPrice-*.csv" -> {updated, count, stations:[...]} */
  function convertFuelFinder(text, sourceName) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("The file is empty.");
    const head = rows[0].map(h => h.trim());
    const col = name => head.indexOf("forecourts." + name);
    const need = ["node_id", "location.latitude", "location.longitude", "location.postcode"];
    const missing = need.filter(n => col(n) < 0);
    if (missing.length) throw new Error("This doesn't look like a Fuel Finder CSV (missing " + missing.join(", ") + ").");
    const C = {
      id: col("node_id"), n: col("trading_name"), b: col("brand_name"),
      mw: col("is_motorway_service_station"), sm: col("is_supermarket_service_station"),
      ph: col("public_phone_number"), tc: col("temporary_closure"), pcl: col("permanent_closure"),
      pc: col("location.postcode"), a1: col("location.address_line_1"), a2: col("location.address_line_2"),
      c: col("location.city"), y: col("location.latitude"), x: col("location.longitude")
    };
    const fuelCols = FUELS.map(f => [f, col("fuel_price." + f), col("price_submission_timestamp." + f)]);
    const amCols = Object.keys(AMENITIES).map(k => [AMENITIES[k], col("amenities." + k)]).filter(a => a[1] >= 0);
    const dayCols = DAYS.map(d => ["open_time", "close_time", "is_24_hours"].map(f => col("opening_times.usual_days." + d + "." + f)));
    const bhCols = ["open_time", "close_time", "is_24_hours"].map(f => col("opening_times.bank_holiday.standard." + f));
    const get = (r, i) => (i >= 0 && i < r.length ? r[i].trim() : "");
    const yes = (r, i) => get(r, i).toLowerCase() === "true";
    const hours = (r, cols) => {
      if (cols[0] < 0) return "";
      if (yes(r, cols[2])) return "24h";
      const o = t5(get(r, cols[0])), c = t5(get(r, cols[1]));
      return (!o || (o === "00:00" && c === "00:00")) ? "" : o + "-" + c;
    };

    const out = [], seen = new Set();
    let skipped = 0;
    for (const r of rows.slice(1)) {
      const id = get(r, C.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (yes(r, C.pcl)) { skipped++; continue; }
      const y = parseFloat(get(r, C.y)), x = parseFloat(get(r, C.x));
      if (!(y >= 49.8 && y <= 61 && x >= -8.8 && x <= 2)) { skipped++; continue; }
      const p = {}; let u = "";
      for (const [f, pi, ti] of fuelCols) {
        const v = price(get(r, pi));
        if (v != null) { p[f] = v; const ts = toISO(get(r, ti)); if (ts > u) u = ts; }
      }
      const a2 = get(r, C.a2);
      const s = {
        id, n: get(r, C.n), b: get(r, C.b),
        a: [get(r, C.a1), a2 === "—" ? "" : a2].filter(Boolean).join(", "),
        c: get(r, C.c), pc: get(r, C.pc).toUpperCase(),
        y: Math.round(y * 1e5) / 1e5, x: Math.round(x * 1e5) / 1e5, p
      };
      if (u) s.u = u;
      if (yes(r, C.mw)) s.mw = 1;
      if (yes(r, C.sm)) s.sm = 1;
      if (yes(r, C.tc)) s.tc = 1;
      const am = amCols.filter(([, i]) => yes(r, i)).map(([k]) => k);
      if (am.length) s.am = am;
      const ph = get(r, C.ph); if (ph) s.ph = ph;
      const h = dayCols.map(cols => hours(r, cols)).concat([hours(r, bhCols)]);
      if (h.some(Boolean)) s.h = h;
      out.push(s);
    }
    if (out.length < 100) throw new Error("Only " + out.length + " usable stations found – not publishing.");
    const m = /UpdatedFuelPrice-(\d{12,})/.exec(sourceName || "");
    const published = m ? new Date(+m[1]).toISOString().slice(0, 16) + "Z" : "";
    return {
      updated: new Date().toISOString().slice(0, 16) + "Z",
      published, source: sourceName || "", count: out.length, skipped, stations: out
    };
  }

  /* Fuel card site list: needs a Postcode column; Site name / Surcharge / HGV / node_id optional */
  function findCol(headers, tests) {
    const h = headers.map(x => x.toLowerCase().trim());
    for (const t of tests) { const i = h.findIndex(x => t.test(x)); if (i >= 0) return i; }
    return -1;
  }
  function yesNo(v) {
    v = String(v || "").trim().toLowerCase();
    if (!v) return null;
    if (/^(n|no|false|0|x|none|not accepted|no hgvs?.*|hgv not.*|not suitable.*|cars? only)$/.test(v)) return false;
    if (/^(y|yes|true|1|✓|accepted|hgv|hgv ok|ok|suitable)$/.test(v)) return true;
    if (/\bno\b|not/.test(v)) return false;
    return null;
  }
  function readUkFuelsList(text) {
    const rows = parseCSV(text);
    if (rows.length < 1) return { rows: [], hasPostcode: false };
    const head = rows[0];
    const iPc = findCol(head, [/post\s*code/, /^pc$/, /post/]);
    const iId = findCol(head, [/node.?id/, /fuel.?finder.?id/]);
    const iName = findCol(head, [/site.?name/, /^name$/, /station/, /site/, /name/]);
    const iSur = findCol(head, [/surcharge/, /pence|ppl|p\/l/, /price/, /charge/]);
    const iHgv = findCol(head, [/^hgv$/, /hgv/, /lorry|truck|lgv/]);
    // optional extras (lists built by Claude / the updater): where the site came from, and sites that aren't in Fuel Finder
    const ex = re => head.findIndex(h => re.test(String(h).trim().toLowerCase()));
    const iSrc = ex(/^src$/), iSName = ex(/^source name$/), iSPc = ex(/^source postcode$/), iAddr = ex(/^address$/), iTown = ex(/^town$/),
          iLat = ex(/^lat(itude)?$/), iLng = ex(/^(lng|lon|long|longitude)$/), iHours = ex(/^hours$/), iExtra = ex(/^not in fuel finder$/),
          iBrand = ex(/^brand$/), iHow = ex(/^matched_by$/), iDist = ex(/^match_m$/);
    const out = [];
    for (const r of rows.slice(1)) {
      const g = i => (i >= 0 && i < r.length ? r[i].trim() : "");
      const rec = { pc: normPc(g(iPc)), id: g(iId), name: g(iName), sur: g(iSur), hgv: iHgv >= 0 ? yesNo(g(iHgv)) : null, raw: r };
      if (iSrc >= 0) Object.assign(rec, { src: g(iSrc), srcName: g(iSName), srcPc: g(iSPc), addr: g(iAddr), town: g(iTown), hours: g(iHours),
        brand: g(iBrand), how: g(iHow), dist: g(iDist), lat: parseFloat(g(iLat)), lng: parseFloat(g(iLng)), extra: yesNo(g(iExtra)) === true });
      if (rec.extra) { rec.id = ""; rec.pc = ""; if (isFinite(rec.lat) && isFinite(rec.lng)) out.push(rec); }   // not in Fuel Finder: placed by its own position
      else if (rec.pc || rec.id) out.push(rec);
    }
    return { rows: out, hasPostcode: iPc >= 0 || iId >= 0 };
  }

  /* Surcharge list for a card (kept as a separate file, applied on top of the card's site list).
     Needs a Postcode (or node_id) column and a surcharge column. "Surcharge PPL" (pence) is preferred;
     a plain "Surcharge" under 1 is read as pounds (0.0125 -> 1.25p). Site name / Group optional. */
  function readSurchargeList(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) return { rows: [], ok: false };
    const head = rows[0];
    const iPc = findCol(head, [/post\s*code|postal/, /^pc$/, /post/]);
    const iId = findCol(head, [/node.?id/, /fuel.?finder.?id/]);
    const iName = findCol(head, [/site.?name/, /^name$/, /station/, /site/, /name/]);
    const iPpl = findCol(head, [/ppl|pence|p\/l/]);
    const iSur = findCol(head, [/^surcharge$/, /surcharge(?!.*group)/]);
    const iGrp = findCol(head, [/group/, /band|tier/]);
    const out = [];
    for (const r of rows.slice(1)) {
      const g = i => (i >= 0 && i < r.length ? String(r[i]).trim() : "");
      let p = parseFloat(g(iPpl).replace(/[^0-9.\-]/g, ""));
      if (!isFinite(p)) { const s = g(iSur), v = parseFloat(s.replace(/[^0-9.\-]/g, "")); if (isFinite(v)) p = (v < 1 || /£/.test(s)) && !/p\b/i.test(s) ? v * 100 : v; }
      const rec = { pcRaw: normPc(g(iPc)), id: g(iId), name: g(iName), group: g(iGrp).replace(/^[A-Z]\s*-\s*/, "").trim(), ppl: isFinite(p) ? Math.round(p * 100) / 100 : null, raw: r };
      if ((rec.pcRaw || rec.id) && rec.ppl != null) out.push(rec);
    }
    return { rows: out, ok: (iPc >= 0 || iId >= 0) && (iPpl >= 0 || iSur >= 0) };
  }
  /* "GU206PJN" (direction letter added) -> "GU206PJ"; returns the longest valid UK postcode prefix */
  function cleanPc(pc) {
    pc = normPc(pc);
    for (let n = pc.length; n >= 5; n--) if (/^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(pc.slice(0, n))) return pc.slice(0, n);
    return pc;
  }

  /* Matching report (used by Admin): which rows of a card's site list / surcharge list
     find a Fuel Finder station. Same rules as the map: node_id, then postcode (direction
     letters trimmed), then for surcharges a clear name match in the same postcode area. */
  function nameScore(name, s) {
    const a = new Set(String(name || "").toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const b = (s.n + " " + s.b + " " + s.a + " " + (s.c || "")).toLowerCase();
    let n = 0; a.forEach(w => { if (b.includes(w)) n++; }); return n;
  }
  function stationIndex(stations) {
    const idx = { pc: new Map(), out: new Map(), id: new Map() };
    for (const s of stations) {
      const pc = normPc(s.pc), out = pc.slice(0, -3);
      if (!idx.pc.has(pc)) idx.pc.set(pc, []); idx.pc.get(pc).push(s);
      if (!idx.out.has(out)) idx.out.set(out, []); idx.out.get(out).push(s);
      idx.id.set(s.id, s);
    }
    return idx;
  }
  function findStation(idx, r, pcRaw, allowName) {
    if (r.id && idx.id.has(r.id)) return idx.id.get(r.id);
    const pc = cleanPc(pcRaw), c = idx.pc.get(pc) || idx.pc.get(pcRaw);
    if (c) return c.length === 1 ? c[0] : c.slice().sort((a, b) => nameScore(r.name, b) - nameScore(r.name, a))[0];
    if (allowName && r.name) {
      const cand = (idx.out.get(pc.slice(0, -3)) || []).map(x => [x, nameScore(r.name, x)]).filter(x => x[1] >= 2).sort((a, b) => b[1] - a[1]);
      if (cand.length && (cand.length === 1 || cand[0][1] > cand[1][1])) return cand[0][0];
    }
    return null;
  }
  function matchReport(stations, siteRows, surRows) {
    const idx = stationIndex(stations), rep = { siteUnmatched: [], surUnmatched: [], siteMatched: 0, surMatched: 0 };
    rep.siteExtra = [];
    for (const r of siteRows || []) { if (r.extra) rep.siteExtra.push(r); else if (findStation(idx, r, r.pc, false)) rep.siteMatched++; else rep.siteUnmatched.push(r); }
    for (const r of surRows || []) { if (findStation(idx, r, r.pcRaw, true)) rep.surMatched++; else rep.surUnmatched.push(r); }
    return rep;
  }

  /* Brand names -> logo keys: "Esso " / "ESSO" -> "ESSO" -> file "esso.png" */
  const brandKey = b => String(b || "").toUpperCase().replace(/\s+/g, " ").trim();
  const brandSlug = b => brandKey(b).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

  /* Placeholder images (shown until a real one is uploaded in Admin) */
  const xesc = s => String(s).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
  const svgUrl = svg => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const CARD_COLOURS = ["#1f4e8c", "#0f6e5a", "#7a2e8e", "#b5452b", "#2d3a4a", "#8a6d1d", "#1d6fa3", "#5b3a29"];
  function dummyCardImg(name) {
    let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const col = CARD_COLOURS[h % CARD_COLOURS.length], nm = xesc(String(name).toUpperCase());
    const fs = nm.length > 14 ? 13 : 16;
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 172 108" width="172" height="108">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>
<rect width="172" height="108" rx="9" fill="${col}"/><rect width="172" height="108" rx="9" fill="url(#g)"/>
<rect x="14" y="34" width="26" height="20" rx="3" fill="#e8c766" stroke="#a8862e" stroke-width="1"/>
<path d="M14 44h26M27 34v20" stroke="#a8862e" stroke-width="1"/>
<text x="14" y="24" font-family="Arial,sans-serif" font-weight="700" font-size="${fs}" fill="#fff">${nm}</text>
<text x="14" y="78" font-family="monospace" font-size="11" fill="#fff" fill-opacity=".85">7000 0000 0000 0000</text>
<text x="14" y="96" font-family="Arial,sans-serif" font-size="8" fill="#fff" fill-opacity=".7">SAMPLE CARD IMAGE</text>
<text x="158" y="96" text-anchor="end" font-family="Arial,sans-serif" font-weight="700" font-size="10" fill="#fff" fill-opacity=".9">FUEL</text>
</svg>`);
  }
  const GENERIC_LOGO = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
<rect x="2" y="2" width="236" height="116" rx="12" fill="#f3f5f8" stroke="#b9c2cc" stroke-width="2" stroke-dasharray="7 5"/>
<g transform="translate(26 26)" fill="#8a96a3"><rect x="0" y="0" width="40" height="68" rx="5"/><rect x="8" y="9" width="24" height="18" rx="2" fill="#f3f5f8"/>
<path d="M40 30h10v28a5 5 0 0 0 10 0V20l-9-9" fill="none" stroke="#8a96a3" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>
<text x="98" y="58" font-family="Arial,sans-serif" font-weight="700" font-size="20" fill="#6b7684">BRAND</text>
<text x="98" y="82" font-family="Arial,sans-serif" font-weight="700" font-size="20" fill="#6b7684">LOGO</text>
</svg>`);

  const api = { parseCSV, convertFuelFinder, readCardList: readUkFuelsList, readUkFuelsList, readSurchargeList, cleanPc, matchReport, normPc, brandKey, brandSlug, dummyCardImg, GENERIC_LOGO };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FuelMap = api;
})(this);
