#!/usr/bin/env python3
"""Download every UK forecourt and its current prices from the GOV.UK Fuel Finder API
and write a compact docs/data/stations.json for the map.

Needs env vars FF_CLIENT_ID and FF_CLIENT_SECRET (Information Recipient credentials).
Standard library only.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("FF_BASE_URL", "https://www.fuel-finder.service.gov.uk").rstrip("/")
OUT = os.environ.get("FF_OUT", os.path.join(os.path.dirname(__file__), "..", "docs", "data", "stations.json"))
MAX_BATCHES = 200          # 500 forecourts per batch -> plenty of headroom
PAUSE = 0.4                # seconds between calls, to be gentle on the service
UK_BOX = (49.8, 61.0, -8.8, 2.0)  # lat min, lat max, lon min, lon max

DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def call(method, path, body=None, token=None):
    """Return (status, parsed_json). 404 is returned, not raised (API uses it for 'no more data')."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json", "User-Agent": "uk-fuel-map/1.0 (GitHub Actions)"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    delay = 2
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, None
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                log(f"  {e.code} on {path}, retrying in {delay}s")
                time.sleep(delay)
                delay *= 2
                continue
            body_txt = e.read()[:300].decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {body_txt}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 5:
                log(f"  network error on {path} ({e}), retrying in {delay}s")
                time.sleep(delay)
                delay *= 2
                continue
            raise
    raise RuntimeError(f"gave up on {path}")


def unwrap(payload):
    """Responses may be bare, or wrapped as {"success":..,"data":..}."""
    if isinstance(payload, dict) and "data" in payload and ("success" in payload or "message" in payload or len(payload) == 1):
        return payload["data"]
    return payload


def get_token(cid, secret):
    status, payload = call("POST", "/api/v1/oauth/generate_access_token",
                           {"client_id": cid, "client_secret": secret})
    data = unwrap(payload) or {}
    tok = data.get("access_token") if isinstance(data, dict) else None
    if not tok:
        raise RuntimeError(f"No access_token in token response (status {status})")
    return tok


def fetch_all(path, token):
    rows = []
    for n in range(1, MAX_BATCHES + 1):
        status, payload = call("GET", f"{path}?batch-number={n}", token=token)
        if status == 404:
            break
        batch = unwrap(payload)
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        log(f"  {path} batch {n}: {len(batch)} (total {len(rows)})")
        time.sleep(PAUSE)
    return rows


def hhmm(t):
    return (t or "")[:5]


def compact_hours(ot):
    """7 day strings (Mon..Sun) + bank holiday: '24h', 'HH:MM-HH:MM', or '' when unknown."""
    if not isinstance(ot, dict):
        return None
    usual = ot.get("usual_days") or {}
    out = []
    for d in DAYS:
        v = usual.get(d) or {}
        if v.get("is_24_hours"):
            out.append("24h")
        else:
            o, c = hhmm(v.get("open")), hhmm(v.get("close"))
            out.append("" if (not o or (o == "00:00" and c == "00:00")) else f"{o}-{c}")
    bh = ot.get("bank_holiday") or {}
    if bh.get("is_24_hours"):
        out.append("24h")
    else:
        o, c = hhmm(bh.get("open_time")), hhmm(bh.get("close_time"))
        out.append("" if (not o or (o == "00:00" and c == "00:00")) else f"{o}-{c}")
    return out


def norm_price(p):
    try:
        p = float(p)
    except (TypeError, ValueError):
        return None
    if p <= 0:
        return None
    if p < 10:          # reported in pounds rather than pence
        p *= 100
    return round(p, 1)


def main():
    cid, secret = os.environ.get("FF_CLIENT_ID"), os.environ.get("FF_CLIENT_SECRET")
    if not cid or not secret:
        log("FF_CLIENT_ID / FF_CLIENT_SECRET not set - add them as repository secrets.")
        return 2

    log("Getting access token")
    token = get_token(cid, secret)
    log("Fetching forecourts")
    sites = fetch_all("/api/v1/pfs", token)
    log("Fetching prices")
    prices = fetch_all("/api/v1/pfs/fuel-prices", token)

    price_by_id = {}
    for p in prices:
        nid = p.get("node_id")
        if not nid:
            continue
        d, latest = {}, ""
        for fp in p.get("fuel_prices") or []:
            v = norm_price(fp.get("price"))
            if v is None or not fp.get("fuel_type"):
                continue
            d[fp["fuel_type"]] = v
            ts = fp.get("price_last_updated") or fp.get("price_change_effective_timestamp") or ""
            latest = max(latest, ts)
        price_by_id[nid] = (d, latest)

    out, skipped_closed, skipped_loc, seen = [], 0, 0, set()
    for s in sites:
        nid = s.get("node_id")
        if not nid or nid in seen:
            continue
        seen.add(nid)
        if s.get("permanent_closure") is True:
            skipped_closed += 1
            continue
        loc = s.get("location") or {}
        try:
            lat, lon = float(loc.get("latitude")), float(loc.get("longitude"))
        except (TypeError, ValueError):
            skipped_loc += 1
            continue
        if not (UK_BOX[0] <= lat <= UK_BOX[1] and UK_BOX[2] <= lon <= UK_BOX[3]):
            skipped_loc += 1
            continue
        addr = ", ".join(x for x in [loc.get("address_line_1"), loc.get("address_line_2")] if x)
        pr, upd = price_by_id.get(nid, ({}, ""))
        rec = {
            "id": nid,
            "n": (s.get("trading_name") or "").strip(),
            "b": (s.get("brand_name") or "").strip(),
            "a": addr,
            "c": (loc.get("city") or "").strip(),
            "pc": (loc.get("postcode") or "").strip().upper(),
            "y": round(lat, 5),
            "x": round(lon, 5),
            "p": pr,
        }
        if upd:
            rec["u"] = upd[:16]
        if s.get("is_motorway_service_station"):
            rec["mw"] = 1
        if s.get("is_supermarket_service_station"):
            rec["sm"] = 1
        if s.get("temporary_closure"):
            rec["tc"] = 1
        if s.get("amenities"):
            rec["am"] = s["amenities"]
        if s.get("fuel_types"):
            rec["ft"] = s["fuel_types"]
        if s.get("public_phone_number"):
            rec["ph"] = s["public_phone_number"]
        h = compact_hours(s.get("opening_times"))
        if h and any(h):
            rec["h"] = h
        out.append(rec)

    if len(out) < 100:
        log(f"Only {len(out)} usable stations - refusing to publish (previous map stays live).")
        return 1

    doc = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "count": len(out),
        "stations": out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    log(f"Wrote {len(out)} stations ({skipped_closed} permanently closed, {skipped_loc} bad/missing location skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
