"""Are the seating sections where the printed chart says they are?

The ring table in js/seats.js is inference, not survey: bearings are arithmetic
from the section numbering, anchored on where each ring starts. Get an anchor
wrong and nothing looks broken - every section still lands in a plausible seat,
facing the field, at a sensible height. It is just the wrong seat, and the only
way to catch that is against the printed chart.

What is checked here is *radial alignment*: which sections share a spoke. That
survives the perspective a seating chart is usually drawn in, where a section's
apparent position is not its bearing but the section it sits behind still is.

Run tools/serve.py first, then: python tools/seatcheck.py
"""
import json, os, sys, time
sys.path.insert(0, r"c:\Image_Mgmt_Workflows\Apps\MileHigh3D\tools")
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/") + "?live"
fails = []

def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)

proc, c = chrome()

# smoke's js() does not await, and the seats module has to be imported.
def jsa(expr):
    r = c.send("Runtime.evaluate", expression=expr,
               returnByValue=True, awaitPromise=True)
    return r.get("result", {}).get("value")

try:
    c.send("Page.enable"); c.send("Runtime.enable"); c.send("Input.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("!!window.__play"):
            break
        time.sleep(0.5)
    time.sleep(8)

    # Every section the selector offers must be placeable.
    n = c.js("""(function(){
      var s = document.getElementById('seatSelect');
      return s ? s.options.length : -1;})()""")
    ok("the selector lists every section", int(n) == 135, n)

    # A section's bearing, read back out of the camera the app would fly to.
    # heading is bearing+180 by construction, so this needs no field centre and
    # no second copy of the arithmetic.
    BEAR = """(function(){
      var out = {};
      [%s].forEach(function(sec){
        var cam = window.__seats.camera(sec);
        out[sec] = cam ? +(((cam.heading + 180) %% 360)).toFixed(1) : null;
      });
      return JSON.stringify(out);})()"""

    raw = c.js(BEAR % "114,323,521,131,231,133,233,100,500,236,118,330,128,228")
    if not isinstance(raw, str):
        print("  raw:", raw)
        raise SystemExit("__seats not exposed")
    got = json.loads(raw)
    # Rings hold different numbers of sections - 36 in the bowl, 47 in the 300s -
    # so a spoke can only line up to within half a section. The 300s sit 6.1
    # degrees apart, so inside about 3 is the closest match that exists, and
    # outside it means a section out.
    def same(a, b, tol=3.2):
        return abs(((got[str(a)] - got[str(b)] + 180) % 360) - 180) < tol

    ok("114, 323 and 521 share a spoke", same(114, 323) and same(114, 521),
       "%s / %s / %s" % (got["114"], got["323"], got["521"]))
    ok("131 sits under 231", same(131, 231), "%s / %s" % (got["131"], got["231"]))
    ok("133 sits under 233", same(133, 233), "%s / %s" % (got["133"], got["233"]))
    ok("100 sits under 500", same(100, 500), "%s / %s" % (got["100"], got["500"]))
    ok("118 sits under 330", same(118, 330), "%s / %s" % (got["118"], got["330"]))
    ok("128 sits under 228, where the club starts", same(128, 228),
       "%s / %s" % (got["128"], got["228"]))
    ok("100 sits under 236, where it ends", same(100, 236),
       "%s / %s" % (got["100"], got["236"]))

    # The plan map is drawn from the same table, so it must have moved too.
    blocks = c.js("""(function(){
      var g = document.getElementById('seatMap');
      return g ? g.querySelectorAll('[data-section]').length : -1;})()""")
    ok("the plan map draws every block", int(blocks) == 135, blocks)

    # And a seat must still be reachable and land where it says.
    c.js("(function(){var p=window.__play;p.pause();p.seek(0);})()")
    c.js("""(function(){document.querySelectorAll('#playCams .camseg__b')
      .forEach(function(b){ if (b.dataset.cam === 'fan') b.click(); });})()""")
    time.sleep(3)
    c.js("""(function(){var s=document.getElementById('seatSelect');
      s.value='323'; s.dispatchEvent(new Event('change'));})()""")
    time.sleep(3)
    c.js("document.getElementById('seatTake').click()")
    time.sleep(5)
    cam = json.loads(c.js("""(function(){var c=window.__view.camera;
      return JSON.stringify({z:+c.position.z.toFixed(1), fov:+c.fov.toFixed(0),
        t:+c.tilt.toFixed(0)});})()"""))
    ok("323 is reachable and up in the third ring", cam["z"] > 1600, cam)
    ok("it still sees wide", cam["fov"] == 75, cam["fov"])

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
