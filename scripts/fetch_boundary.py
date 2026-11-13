#!/usr/bin/env python3
"""Download the UK outline (Natural Earth, public domain) and save a slimmed copy
to docs/data/uk.geojson. The map uses it to grey out everything that isn't the UK."""
import json
import os
import sys
import urllib.request

URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "uk.geojson")


def rnd(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 4), round(coords[1], 4)]
    return [rnd(c) for c in coords]


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "uk-fuel-map/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        world = json.load(r)
    for f in world["features"]:
        p = f.get("properties", {})
        if p.get("ADM0_A3") == "GBR" or p.get("ISO_A3") == "GBR":
            g = f["geometry"]
            g["coordinates"] = rnd(g["coordinates"])
            os.makedirs(os.path.dirname(OUT), exist_ok=True)
            with open(OUT, "w") as fh:
                json.dump({"type": "Feature", "properties": {"name": "United Kingdom"}, "geometry": g},
                          fh, separators=(",", ":"))
            print("Saved UK outline", file=sys.stderr)
            return 0
    print("UK not found in boundary file", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
