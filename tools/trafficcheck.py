"""Getting out: are the roads real, and is the arithmetic checkable?

Egress is the half of a game day nobody demonstrates. Arrival spreads over three
hours and everybody in it chooses when to make it; departure is seventy-six
thousand people deciding at one whistle, onto the network that is already
carrying the city's ordinary Sunday.

The panel that answers it is the one place in this app that makes a quantitative
claim about something outside the property line, so the thing worth checking is
not that it renders. It is that every number on it can be re-derived:

  * the roads are CDOT's own published counts, not a shape somebody drew - so
    the layer has to carry exactly what the file carries, and the file has to
    carry what CDOT's schema says it does
  * the arithmetic is a division anybody can check in their head, with its one
    assumption stated on screen rather than buried - so the seats, the occupancy
    and the vehicle count all have to appear, and the third has to be the first
    two divided
  * the finding is that there is no spare network, so a road over capacity has
    to be visibly marked as one

A panel that said "estimated clearance: 47 minutes" would be more impressive and
would be a fabrication. What is asserted here is smaller and true, and this is
what keeps it that way.

Run tools/serve.py first, then: python tools/trafficcheck.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "data", "traffic.json"))
URL = os.environ.get("APP_URL", "http://localhost:8777/")
fails = []


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


STATE = """(function(){
  var l = window.__view.map.allLayers.find(function(x){return x.title==='Traffic';});
  var rows = [].map.call(document.getElementById('egressRing').children,
    function(r){ return {
      name: r.querySelector('.egrow__name').textContent,
      vc: parseFloat(r.querySelector('.egrow__vc').textContent),
      over: r.querySelector('.egrow__vc').classList.contains('over'),
      width: r.querySelector('.egrow__fill').style.width };});
  return JSON.stringify({
    open: !document.getElementById('egressPanel').hidden,
    layer: l ? (l.visible ? 'visible' : 'hidden') : 'missing',
    graphics: l && l.source ? l.source.length : null,
    sum: document.getElementById('egressSum').textContent,
    note: document.getElementById('egressNote').textContent,
    year: document.getElementById('egressYear').textContent,
    keys: document.getElementById('egressKey').children.length,
    rows: rows,
    toolOn: document.getElementById('egress').classList.contains('active')
  });})()"""


def st(c):
    return json.loads(c.js(STATE))


# --- the file, before the browser is involved -------------------------------
ok("the counts are committed alongside the app", os.path.exists(DATA), DATA)
if not os.path.exists(DATA):
    print("\nFAILED  — run tools/build_traffic.py")
    sys.exit(1)

doc = json.load(open(DATA, encoding="utf-8"))
segs = doc.get("segments", [])
ok("and there are segments in it", len(segs) > 20, "%d" % len(segs))
ok("each carries a count, a capacity and a ratio",
   all(s.get("aadt") and s.get("capacity") and s.get("vc") is not None
       for s in segs))
ok("and a geometry that is a real line",
   all(len(s.get("paths") or []) and len(s["paths"][0]) >= 2 for s in segs))
ok("the source is named in the file", bool(doc.get("source")), doc.get("source"))
ok("and so is the year", bool(doc.get("year")), doc.get("year"))
# The finding the panel rests on. If CDOT ever reports slack around this venue
# the panel's sentence stops being true, and this is where that surfaces.
over = [s for s in segs if s["vc"] >= 1]
ok("at least one road is over capacity, which is the finding",
   bool(over), "%d of %d segments" % (len(over), len(segs)))

routes = sorted({s["name"] for s in segs})
worst = {}
for s in segs:
    worst[s["name"]] = max(worst.get(s["name"], 0), s["vc"])

proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("!!window.__view && !!window.__sky"):
            break
        time.sleep(0.5)
    for _ in range(180):
        if not c.js("document.getElementById('enter').disabled"):
            break
        time.sleep(0.5)
    c.js("document.getElementById('enter').click()")
    time.sleep(9)

    # Nothing is fetched or drawn until it is asked for.
    s = st(c)
    ok("nothing is loaded before anybody asks", s["layer"] == "missing", s["layer"])

    c.js("document.getElementById('egress').click()")
    time.sleep(6)
    s = st(c)
    ok("pressing it opens the panel", s["open"] is True)
    ok("and the tool reads as active", s["toolOn"] is True)
    ok("the roads are on the map", s["layer"] == "visible", s["layer"])
    ok("every segment in the file is on it", s["graphics"] == len(segs),
       "%s of %d" % (s["graphics"], len(segs)))
    ok("the year on the panel is the year in the file",
       str(doc["year"]) in s["year"], s["year"])
    ok("and the source is credited on screen",
       "Colorado Department of Transportation" in s["note"], s["note"][:60])

    # --- the arithmetic is stated, not just its answer ----------------------
    txt = s["sum"]
    ok("the panel states the seats", "76,125" in txt, txt[:70])
    ok("and the occupancy it assumed", "2.6" in txt, txt[:70])
    cars = round(76125 / 2.6)
    ok("and the vehicle count is those two divided",
       "{:,}".format(cars) in txt, "wanted %s" % "{:,}".format(cars))

    # --- one row per road, and the worst stretch of it ----------------------
    ok("one row per road", len(s["rows"]) == len(routes),
       "%d rows, %d routes" % (len(s["rows"]), len(routes)))
    shown = {r["name"]: r["vc"] for r in s["rows"]}
    ok("each row shows that road's worst ratio",
       all(abs(shown.get(n, -1) - round(worst[n], 2)) < 0.011 for n in routes),
       str({n: (shown.get(n), round(worst[n], 2)) for n in routes
            if abs(shown.get(n, -1) - round(worst[n], 2)) >= 0.011} or "all match"))
    ok("a road over capacity is marked as one",
       all(r["over"] == (r["vc"] >= 1) for r in s["rows"]),
       str([(r["name"], r["vc"], r["over"]) for r in s["rows"]
            if r["over"] != (r["vc"] >= 1)] or "all match"))
    # The bar is capped at its own track: 1.17 is a fact about the road, and a
    # bar running past its rail would read as a rendering fault.
    ok("and its bar stops at the end of the track",
       all(float((r["width"] or "0%").rstrip("%")) <= 100.5 for r in s["rows"]),
       str([r["width"] for r in s["rows"]][:4]))
    ok("the key names every band", s["keys"] == 4, s["keys"])

    # --- it gets out of the way ---------------------------------------------
    c.js("document.getElementById('measure').click()")
    time.sleep(3)
    s = st(c)
    ok("opening another panel puts the roads away",
       s["open"] is False and s["layer"] == "hidden", s["layer"])
    c.js("document.getElementById('measure').click()")
    time.sleep(1)

    c.js("document.getElementById('egress').click()")
    time.sleep(4)
    ok("and it comes back", st(c)["layer"] == "visible")
    c.js("document.getElementById('egressClose').click()")
    time.sleep(2)
    s = st(c)
    ok("closing it hides the roads",
       s["open"] is False and s["layer"] == "hidden", s["layer"])
    ok("and the tool stops reading as active", s["toolOn"] is False)

    print("")
    print("  errors:", c.errs or "none")
    if c.errs:
        fails.append("console errors")
finally:
    proc.terminate()

print("")
print("%s  (%d failed)" % ("PASSED" if not fails else "FAILED", len(fails)))
for f in fails:
    print("   - %s" % f)
sys.exit(1 if fails else 0)
