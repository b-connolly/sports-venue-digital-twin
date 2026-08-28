"""The roads the crowd has to leave on, and how much room they have.

Egress is the harder half of a game day and the one nobody demonstrates. Arrival
is spread over three hours and people choose when to make it; departure is
seventy-six thousand people deciding at the same whistle, and the network they
decide onto is the same network that carries the city's ordinary Sunday.

So this fetches CDOT's own count segments around the venue - real published
counts, not a model - and keeps three numbers per segment:

    AADT        annual average daily traffic, in vehicles
    ROUTECAPAC  the segment's hourly capacity, from CDOT's own model
    VCRATIO     volume over capacity at the design hour

The third is the one that makes the point. Every arterial ringing this stadium
is already at or over nine tenths of capacity at peak on an ordinary day: I-25
at 1.10, US-6 at 1.05, Colfax at 0.97, Sheridan at 0.91. There is no spare
network. A sellout adds about thirty-one thousand vehicles to it inside twenty
minutes, and the app can now say so with somebody else's numbers rather than
its own.

What this is not: game-day traffic. AADT is an annual average of all days, and
CDOT does not publish an hourly series here. The honest claim is about the
*baseline* - what the roads normally carry and how close to full that leaves
them - and the app labels it that way. Anything stronger needs NPMRDS or CDOT's
continuous count stations, which are a data-sharing agreement rather than a
download.

    propy build_traffic.py

Writes ../data/traffic.json, which is committed: GitHub Pages serves straight
from the repository, and a demo should not depend on a state DOT's server being
up on the day. Sixty-five segments is about 40 kB.
"""
import json
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "data", "traffic.json"))

# CDOT's own server carries the current year; the copy mirrored to ArcGIS Online
# is several years behind - 2018 against 2024 at the time of writing - so this
# asks the source. If it is down, the mirror is
# services.arcgis.com/yzB9WM8W0BO3Ql7d/.../TrafficData/FeatureServer/0 with the
# same field names, and the only thing that changes is the vintage.
SRC = ("https://dtdapps.codot.gov/server/rest/services/Webapps/"
       "open_data_sde/FeatureServer/13/query")

# Far enough out to catch the interstate and every arterial the lots feed onto,
# and no further: this is about the venue's egress, not Denver's network.
BBOX = "-105.075,39.709,-104.965,39.779"

FIELDS = "ROUTE,AADT,AADTYR,ROUTECAPAC,VCRATIO,DHV,LENGTH_,REFPT,ENDREFPT"

# CDOT names routes by number and section - "025A", "088A" - which is precise
# and says nothing to anybody looking at a map. The classification is carried in
# the number, so only the number is translated; the section letter is dropped.
# Anything not listed keeps its code rather than being guessed at.
NAMED = {
    "006": ("US 6", "Sixth Avenue Freeway"),
    "025": ("I-25", "Interstate 25"),
    "026": ("SH 26", None),
    "040": ("US 40", "Colfax Avenue"),
    "070": ("I-70", "Interstate 70"),
    "085": ("US 85", "Santa Fe Drive"),
    "088": ("SH 88", "Federal Boulevard"),
    "095": ("SH 95", "Sheridan Boulevard"),
    "121": ("SH 121", "Wadsworth Boulevard"),
    "287": ("US 287", None),
}


def label(route):
    """"025A" -> ("I-25", "Interstate 25"). Unknown codes keep themselves."""
    code = (route or "").strip()
    num = code[:3]
    if num in NAMED:
        return NAMED[num]
    return (code or "Route", None)


def fetch():
    params = {
        "geometry": BBOX,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": FIELDS,
        "returnGeometry": "true",
        "outSR": "4326",
        # The segments are already short; simplifying them saves nothing worth
        # the risk of a road that no longer follows the road.
        "f": "json",
    }
    url = SRC + "?" + urllib.parse.urlencode(params)
    print("fetching CDOT counts ...")
    with urllib.request.urlopen(url, timeout=120) as res:
        return json.loads(res.read().decode("utf-8"))


def main():
    data = fetch()
    if "error" in data:
        raise SystemExit("CDOT: %s" % data["error"].get("message"))
    feats = data.get("features", [])
    if not feats:
        raise SystemExit("no segments came back - has the bounding box moved?")

    out, years = [], set()
    for f in feats:
        a = f.get("attributes", {})
        paths = (f.get("geometry") or {}).get("paths") or []
        if not paths:
            continue
        aadt = a.get("AADT")
        if not aadt:
            continue                      # a segment with no count says nothing
        name, also = label(a.get("ROUTE"))
        years.add(str(a.get("AADTYR") or ""))
        out.append({
            "route": a.get("ROUTE"),
            "name": name,
            "also": also,
            "aadt": int(aadt),
            "capacity": int(a.get("ROUTECAPAC") or 0),
            # CDOT stores this as a float with more precision than it has.
            "vc": round(float(a.get("VCRATIO") or 0), 3),
            "dhv": round(float(a.get("DHV") or 0), 1),
            # Rounded to about a metre. The full precision is seven decimals of
            # a degree, which is a centimetre, on a line whose real accuracy is
            # a lane width - and it triples the file.
            "paths": [[[round(x, 5), round(y, 5)] for x, y in path]
                      for path in paths],
        })

    out.sort(key=lambda s: -s["aadt"])
    doc = {
        "source": "Colorado Department of Transportation, Highways: Traffic Counts",
        "url": SRC.replace("/query", ""),
        "year": sorted(y for y in years if y)[-1] if years else None,
        "note": ("Annual average daily traffic. An average of all days, not a "
                 "game day: what these show is the baseline the crowd leaves "
                 "into, and how little of it is spare."),
        "segments": out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))

    routes = {}
    for s in out:
        r = routes.setdefault(s["name"], {"n": 0, "aadt": 0, "vc": 0})
        r["n"] += 1
        r["aadt"] = max(r["aadt"], s["aadt"])
        r["vc"] = max(r["vc"], s["vc"])

    print("")
    print("wrote %s" % OUT)
    print("  %d segments, %.0f kB, %s counts"
          % (len(out), os.path.getsize(OUT) / 1024.0, doc["year"]))
    print("")
    print("  %-8s %-4s %-9s %s" % ("route", "segs", "peak AADT", "worst v/c"))
    for name in sorted(routes, key=lambda k: -routes[k]["aadt"]):
        r = routes[name]
        print("  %-8s %-4d %-9d %.2f%s"
              % (name, r["n"], r["aadt"], r["vc"],
                 "   over capacity" if r["vc"] >= 1 else ""))


if __name__ == "__main__":
    main()
