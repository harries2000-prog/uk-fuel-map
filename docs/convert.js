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

  /* UK Fuels list: needs a Postcode column; Site name / Surcharge / HGV / node_id optional */
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
    const iHgv = findCol(head, [/hgv/, /lorry|truck|lgv/]);
    const out = [];
    for (const r of rows.slice(1)) {
      const g = i => (i >= 0 && i < r.length ? r[i].trim() : "");
      const rec = { pc: normPc(g(iPc)), id: g(iId), name: g(iName), sur: g(iSur), hgv: iHgv >= 0 ? yesNo(g(iHgv)) : null, raw: r };
      if (rec.pc || rec.id) out.push(rec);
    }
    return { rows: out, hasPostcode: iPc >= 0 || iId >= 0 };
  }

  const api = { parseCSV, convertFuelFinder, readUkFuelsList, normPc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FuelMap = api;
})(this);
