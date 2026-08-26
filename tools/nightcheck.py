"""Do the night views arrive at night, with the ground lit?

Two views are authored for half past ten at night, and getting there is an
animation: the slide is stamped with the hour it wants and the flight carries
the sun to it. Anything that replaces the scene's lighting part way through
destroys the value being animated and the clock stops where it stood.

That is not hypothetical. Switching the floodlights on swaps the scene to
virtual lighting, which carries no date at all, and an automatic dusk switch
did exactly that: the walk from midday to half past ten crossed dusk, the
floodlights came on, and Stadium at Night arrived frozen at a quarter to eight
with its own floodlights filtered out of the shot - the one view that exists to
show them.

So this checks the arrival rather than the mechanism: the hour on the clock, the
fixtures being visible, and nothing filtering them.

Run tools/serve.py first, then: python tools/nightcheck.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/")
fails = []


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


STATE = """(function(){
  var s = window.__sky, L = window.__view.environment.lighting;
  var l = (s && s.nightLayers && s.nightLayers[0]) || null;
  return JSON.stringify({
    slide: (document.getElementById('tourIdx')||{}).textContent,
    title: (document.getElementById('tourTitle')||{}).textContent,
    clock: (document.getElementById('wxTime')||{}).textContent,
    hour: L && L.date ? new Date(L.date).getUTCHours() : null,
    panel: !document.getElementById('playPanel').hidden,
    btnHidden: document.getElementById('lightsBtn').hidden,
    lit: s ? !!s.lit : null,
    vis: l ? l.visible : null,
    filtered: l ? !!l.definitionExpression : null});})()"""

proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL + "?live")
    for _ in range(400):
        if c.js("!!window.__play"):
            break
        time.sleep(0.5)
    time.sleep(9)

    for _ in range(3):                    # 01 -> 04
        c.js("document.getElementById('next').click()")
        time.sleep(11)

    s = json.loads(c.js(STATE))
    ok("reached the night view", s["slide"].startswith("04"), s["title"])
    ok("the clock arrives at the hour the view was authored for",
       "10:30 PM" in (s["clock"] or ""), s["clock"])
    ok("the ground's fixtures are showing", s["vis"] is True, s)
    # The filter exists to take the roof and aisle lights out while somebody has
    # a switch for them. With no replay on screen there is no switch, and the
    # rim of floodlights is the whole shot.
    ok("and nothing is filtering them out", s["filtered"] is False, s)
    ok("the replay is put away", s["panel"] is False, s)
    ok("and its light switch with it", s["btnHidden"] is True, s)

    # --- and the view after it, which starts from wherever this one left off --
    c.js("document.getElementById('next').click()")
    time.sleep(11)
    s = json.loads(c.js(STATE))
    ok("the next night view starts at night too",
       s["hour"] is not None and (s["hour"] >= 4 and s["hour"] <= 7),
       "%s (UTC hour %s)" % (s["clock"], s["hour"]))
    ok("with its fixtures showing as well", s["vis"] is True, s)

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
