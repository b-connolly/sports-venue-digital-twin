"""Does a seat let go of the camera when you leave it?

The drag from a seat is intercepted - a scene view has no first-person mode, so
the only way to turn a spectator's head is to take the gesture and rewrite
heading and tilt. That interception has to end when the viewer leaves, and the
first version never did: `seat` was set when a seat was taken and cleared
nowhere, so every drag in the app went on being swallowed. Slides changed under
a camera that still turned like a head, Home flew out to an aerial view that
still would not pan, and the recenter button sat there over a view with no ball
in it.

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


def moved(a, b):
    return (abs(a["lon"] - b["lon"]) > 1e-6 or abs(a["lat"] - b["lat"]) > 1e-6
            or abs(a["z"] - b["z"]) > 1.0)


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

    # --- and now leave, by the routes that were reported broken -----------
    for name, js in [
            ("the home button", "document.getElementById('home').click()"),
            ("stepping to the next slide",
             "document.getElementById('next').click()")]:
        # back into a seat each time
        c.js("""(function(){document.querySelectorAll('#playCams .camseg__b')
          .forEach(function(b){ if (b.dataset.cam === 'fan') b.click(); });})()""")
        time.sleep(3)
        c.js("""(function(){var s=document.getElementById('seatSelect');
          s.value='117'; s.dispatchEvent(new Event('change'));})()""")
        time.sleep(3)
        c.js("document.getElementById('seatTake').click()")
        time.sleep(5)
        c.js(js)
        time.sleep(4)

        before = json.loads(c.js(CAM))
        drag(c, 700, 350, 880, 350)
        after = json.loads(c.js(CAM))
        ok("after %s, dragging moves the camera again" % name,
           moved(before, after),
           "lon %.7f -> %.7f  z %.1f -> %.1f"
           % (before["lon"], after["lon"], before["z"], after["z"]))
        ok("after %s, the recenter button is gone" % name,
           bool(c.js("document.getElementById('playRecenter').hidden")))

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
