"""Does the replay panel get out of the way while a passage is running?

740px of furniture in front of the thing it exists to show. While the play is
running and the pointer is elsewhere the two blocks that take the room - the row
of plays and the caption - fold away, and what is left dims to a strip.

A strip rather than nothing, deliberately: the way back is to put the pointer on
the panel, so the panel has to stay somewhere the pointer can be put.

Run tools/serve.py first, then: python tools/dockcheck.py
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


BOX = """(function(){
  var e = document.getElementById('playPanel');
  var r = e.getBoundingClientRect();
  var bar = document.querySelector('#playPanel .dock__bar');
  return JSON.stringify({
    canrest: e.classList.contains('canrest'),
    h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
    w: Math.round(r.width),
    barOp: +getComputedStyle(bar).opacity,
    panelOp: +getComputedStyle(e).opacity});})()"""


def box(c):
    return json.loads(c.js(BOX))


proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Input.enable")
    c.send("Page.navigate", url=URL + "?live")
    for _ in range(400):
        if c.js("!!window.__play"):
            break
        time.sleep(0.5)
    time.sleep(9)

    # ?live starts the passage on load, so pause it to see the resting case.
    c.js("(function(){window.__play.pause();})()")
    time.sleep(1.5)
    here = box(c)
    ok("paused, the panel does not fold", here["canrest"] is False, here)

    c.js("(function(){window.__play.start();})()")
    time.sleep(1)
    ok("running, folding is allowed", box(c)["canrest"] is True)

    # pointer well away from it
    c.send("Input.dispatchMouseEvent", type="mouseMoved", x=200, y=150)
    time.sleep(4)
    rest = box(c)
    full = here["h"]
    ok("it folds to a strip", rest["h"] < 140, "%s px" % rest["h"])
    ok("its contents dim", rest["barOp"] < 0.9, rest["barOp"])
    # The panel itself must keep its glass, or the controls ghost over the scene.
    ok("but the panel keeps its own surface", rest["panelOp"] > 0.95,
       rest["panelOp"])
    ok("and it stays put, so there is somewhere to aim",
       rest["w"] > 300 and rest["h"] > 40, rest)

    # pointer back onto it
    c.send("Input.dispatchMouseEvent", type="mouseMoved",
           x=rest["x"] + rest["w"] // 2, y=rest["y"] + 20)
    time.sleep(1.5)
    back = box(c)
    ok("pointing at it brings it back", back["h"] > rest["h"] + 40,
       "%s -> %s px" % (rest["h"], back["h"]))
    ok("at full strength", back["barOp"] > 0.95, back["barOp"])

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
