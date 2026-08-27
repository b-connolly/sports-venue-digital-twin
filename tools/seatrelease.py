"""Does a seat let go of the camera when you leave it - and offer the way back?

The drag from a seat is intercepted - a scene view has no first-person mode, so
the only way to turn a spectator's head is to take the gesture and rewrite
heading and tilt. That interception has to end when the viewer leaves, and the
first version never did: `seat` was set when a seat was taken and cleared
nowhere, so every drag in the app went on being swallowed. Slides changed under
a camera that still turned like a head, Home flew out to an aerial view that
still would not pan, and the recenter button sat there over a view with no ball
in it.

The other half is newer, and it is the opposite mistake. Leaving the *seat* was
being treated as leaving *fan perspective*, so the moment the camera moved -
Home, or a stray scroll - the offer of the way back went with it, and a viewer
who had drifted out of the stand was left in fan perspective with no seat and
no way into one short of reopening the chooser. The offer now outlives leaving
the seat and is cleared only when the mode is. And the scroll that started it
cannot happen at all any more: a seat is a fixed point, so zoom is locked while
one is held.

    leaving the seat  ->  drag navigates again, the way back is still offered
    leaving the mode  ->  the way back goes too

What is checked here is the leaving, not the sitting - seatcheck.py covers the
seat itself.

Run tools/serve.py first, then: python tools/seatrelease.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/") + "?live"
fails = []


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


CAM = """(function(){
  var c = window.__view.camera, p = c.position;
  return JSON.stringify({lon:+p.longitude.toFixed(7), lat:+p.latitude.toFixed(7),
    z:+p.z.toFixed(2), h:+c.heading.toFixed(2), t:+c.tilt.toFixed(2)});})()"""


def drag(c, x0, y0, x1, y1, steps=6):
    c.send("Input.dispatchMouseEvent", type="mousePressed", x=x0, y=y0,
           button="left", clickCount=1, buttons=1)
    for i in range(1, steps + 1):
        c.send("Input.dispatchMouseEvent", type="mouseMoved",
               x=int(x0 + (x1 - x0) * i / steps),
               y=int(y0 + (y1 - y0) * i / steps), button="left", buttons=1)
        time.sleep(0.05)
    c.send("Input.dispatchMouseEvent", type="mouseReleased", x=x1, y=y1,
           button="left", clickCount=1, buttons=1)
    time.sleep(1.2)


def wheel(c, x, y, dy):
    c.send("Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y,
           deltaX=0, deltaY=dy)
    time.sleep(0.9)


def dblclick(c, x, y):
    for n in (1, 2):
        c.send("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y,
               button="left", clickCount=n, buttons=1)
        c.send("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y,
               button="left", clickCount=n, buttons=0)
    time.sleep(1.6)


def moved(a, b):
    return (abs(a["lon"] - b["lon"]) > 1e-6 or abs(a["lat"] - b["lat"]) > 1e-6
            or abs(a["z"] - b["z"]) > 1.0)


def zooms(c):
    """Does the wheel still move the camera? The control case for the lock."""
    was = json.loads(c.js(CAM))
    wheel(c, 700, 400, -480)
    return moved(was, json.loads(c.js(CAM)))


proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Input.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("!!window.__play"):
            break
        time.sleep(0.5)
    time.sleep(10)

    # --- sit down --------------------------------------------------------
    c.js("(function(){var p=window.__play;p.pause();p.seek(0);})()")
    c.js("""(function(){document.querySelectorAll('#playCams .camseg__b')
      .forEach(function(b){ if (b.dataset.cam === 'fan') b.click(); });})()""")
    time.sleep(4)
    c.js("""(function(){var s=document.getElementById('seatSelect');
      s.value='117'; s.dispatchEvent(new Event('change'));})()""")
    time.sleep(3)
    c.js("document.getElementById('seatTake').click()")
    time.sleep(5)

    seated = json.loads(c.js(CAM))
    drag(c, 700, 400, 860, 400)
    turned = json.loads(c.js(CAM))
    ok("seated, a drag turns the head and not the seat",
       not moved(seated, turned)
       and abs(((turned["h"] - seated["h"] + 180) % 360) - 180) > 3,
       "moved=%s dh=%.1f" % (moved(seated, turned),
                             abs(((turned["h"] - seated["h"] + 180) % 360) - 180)))

    # --- the seat is a fixed point ---------------------------------------
    # The gesture that used to strand people. Scrolled hard, and both ways, in
    # case one direction is clamped by something else: the claim is not that a
    # notch does nothing, it is that the camera cannot leave the stand.
    held = json.loads(c.js(CAM))
    for dy in (-480, 480):
        wheel(c, 700, 400, dy)
    now = json.loads(c.js(CAM))
    ok("scrolling does not move the camera out of the seat",
       not moved(held, now), "%s vs %s" % (held, now))
    # The other way in. A double-click on the turf zooms a scene view to the
    # point under the cursor, which from a seat is the same trip out of the
    # stand by a different gesture.
    dblclick(c, 700, 480)
    now = json.loads(c.js(CAM))
    ok("nor does a double-click on the field",
       not moved(held, now), "%s vs %s" % (held, now))
    # The drag above handed the camera over, which is what puts the button up
    # in the first place. It is still the seat's button and the seat is still
    # under it - the scroll changed nothing either way.
    ok("and the way back is still on offer after the drag",
       not c.js("document.getElementById('playRecenter').hidden"))

    # --- leaving the seat, which is not leaving fan perspective ----------
    # Home flies the camera out of the stand without touching the mode: nothing
    # deselects Fan Perspective, so the seat is given up and the way back to it
    # is not. That is the whole of the change this checks.
    c.js("document.getElementById('home').click()")
    time.sleep(4)

    before = json.loads(c.js(CAM))
    drag(c, 700, 350, 880, 350)
    after = json.loads(c.js(CAM))
    ok("out of the seat, dragging moves the camera again",
       moved(before, after),
       "lon %.7f -> %.7f  z %.1f -> %.1f"
       % (before["lon"], after["lon"], before["z"], after["z"]))
    ok("out of the seat, the way back is still offered",
       not c.js("document.getElementById('playRecenter').hidden"))
    ok("and fan perspective is still the mode",
       bool(c.js("""(function(){var b=null;
         document.querySelectorAll('#playCams .camseg__b').forEach(function(x){
           if (x.dataset.cam === 'fan') b = x;});
         return !!b && b.classList.contains('on');})()""")))

    c.js("document.getElementById('playRecenter').click()")
    time.sleep(6)
    back = json.loads(c.js(CAM))
    ok("pressing it puts the viewer back in the seat",
       not moved(seated, back), "%s vs %s" % (seated, back))

    # --- leaving fan perspective, which does take the offer with it ------
    for name, js in [
            ("switching to broadcast",
             """(function(){document.querySelectorAll('#playCams .camseg__b')
               .forEach(function(b){
                 if (b.dataset.cam === 'broadcast') b.click(); });})()"""),
            ("stepping to the next slide",
             "document.getElementById('next').click()")]:
        c.js(js)
        time.sleep(5)
        ok("after %s, the way back is gone" % name,
           bool(c.js("document.getElementById('playRecenter').hidden")))
        ok("after %s, the wheel navigates again" % name, zooms(c))
        # back into a seat for the next round
        c.js("""(function(){document.querySelectorAll('#playCams .camseg__b')
          .forEach(function(b){ if (b.dataset.cam === 'fan') b.click(); });})()""")
        time.sleep(3)
        c.js("""(function(){var s=document.getElementById('seatSelect');
          s.value='117'; s.dispatchEvent(new Event('change'));})()""")
        time.sleep(3)
        c.js("document.getElementById('seatTake').click()")
        time.sleep(5)

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
